/**
 * Notes Service
 * Business logic for note operations
 * Extracted from routes for better maintainability and testability
 */

const Note = require('../models/Note');
const User = require('../models/User');
const mongoose = require('mongoose');
const { errorMessages } = require('../constants');
const { imagesDir, filesDir } = require('../config/paths');
const { ZipWriter } = require('../utils/zipWriter');
const { readZipEntries } = require('../utils/zipReader');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { validateImageFile } = require('../utils/magicNumberValidator');
const { assertStorageQuota } = require('../utils/storageQuota');

const NOTE_COLORS = new Set([
  '#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb',
  '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed'
]);
const TAG_PATTERN = /^[a-zA-Z0-9äöüÄÖÜß\-_]+$/;
// ZIP-Import (v1.14.0): erlaubte Bild-Endungen — konsistent zu den Formaten,
// die validateImageFile per Magic Bytes erkennt (jpg/png/gif/webp).
const ZIP_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_IMAGE_PIXELS = 40000000;
const MAX_IMAGES_PER_NOTE = 25;
const MAX_FILES_PER_NOTE = 25;
const NOTE_CONFLICT_MESSAGE = 'Die Notiz wurde inzwischen geändert';
// Baum (v1.10.0): Zweites Netz unter dem Zyklus-Schutz — siehe assertValidParent.
const MAX_TREE_DEPTH = 50;
// Notiz-Historie (v1.13.0): gecapptes revisions[] — 10 Fassungen pro Notiz.
const REVISIONS_LIMIT = 10;
// MongoDB truncates timestamps to milliseconds and clients may round when
// serializing, so small skews must not look like a concurrent edit.
const CONFLICT_TOLERANCE_MS = 1000;

function clientError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/**
 * Access filter for collaborative edits: the owner and everyone the note is
 * shared with may change its content — text, tags, colour, pin, images and
 * transcriptions. Destructive or structural operations (delete, archive,
 * share/unshare) filter explicitly on `userId` and therefore stay owner-only.
 */
function noteEditQuery(noteId, userId) {
  return {
    _id: noteId,
    deletedAt: null,
    $or: [
      { userId },
      { sharedWith: userId }
    ]
  };
}

/**
 * Parse the optimistic-locking precondition sent by the client.
 * Returns the parsed Date, or null when the value is absent, empty, or not
 * date-parseable (invalid values are treated like a missing value so that
 * robust old clients keep working instead of receiving a 400).
 */
function parseBaseUpdatedAt(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function throwNoteConflict(note) {
  const error = new Error(NOTE_CONFLICT_MESSAGE);
  error.statusCode = 409;
  // The stored note travels with the error so the route can return it in the
  // same serialized form as a regular PUT response. Hat die Notiz Revisionen,
  // reisen sie als Kopie ohne die Historie mit (review v1.14.0: sonst bis zu
  // 10 Volltext-Snapshots pro 409-Antwort); ohne Revisionen bleibt die
  // Referenz unverändert — als Null-Kosten-Fall.
  if (note && Array.isArray(note.revisions) && note.revisions.length > 0) {
    const plain = typeof note.toJSON === 'function' ? note.toJSON() : { ...note };
    delete plain.revisions;
    error.currentNote = plain;
  } else {
    error.currentNote = note;
  }
  throw error;
}

function normalizePositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function validateNoteContent({ isTodoList, todoItems, content }) {
  if (isTodoList) {
    const hasValidTodoItems = Array.isArray(todoItems) &&
      todoItems.some(item => typeof item?.text === 'string' && item.text.trim());
    if (!hasValidTodoItems) {
      throw clientError('Todo-Liste muss mindestens ein Element enthalten');
    }
    return;
  }

  if (typeof content !== 'string' || !content.trim()) {
    throw clientError('Inhalt ist erforderlich');
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function validateNoteFields(noteData) {
  if (!noteData || typeof noteData !== 'object' || Array.isArray(noteData)) {
    throw clientError('Ungueltige Notizdaten');
  }

  if (noteData.title !== undefined && (typeof noteData.title !== 'string' || noteData.title.length > 200)) {
    throw clientError('Titel darf maximal 200 Zeichen lang sein');
  }
  if (noteData.content !== undefined && (typeof noteData.content !== 'string' || noteData.content.length > 10000)) {
    throw clientError('Inhalt darf maximal 10.000 Zeichen lang sein');
  }
  if (noteData.color !== undefined && !NOTE_COLORS.has(noteData.color)) {
    throw clientError('Ungueltige Notizfarbe');
  }
  for (const field of ['isPinned', 'isTodoList', 'isArchived']) {
    if (noteData[field] !== undefined && typeof noteData[field] !== 'boolean') {
      throw clientError(`${field} muss ein Boolean sein`);
    }
  }

  if (noteData.tags !== undefined) {
    if (!Array.isArray(noteData.tags) || noteData.tags.length > 50) {
      throw clientError('Maximal 50 Tags sind erlaubt');
    }
    if (noteData.tags.some(tag => typeof tag !== 'string' || tag.length < 1 || tag.length > 50 || !TAG_PATTERN.test(tag))) {
      throw clientError('Ungueltiger Tag');
    }
  }

  if (noteData.todoItems !== undefined) {
    if (!Array.isArray(noteData.todoItems) || noteData.todoItems.length > 200) {
      throw clientError('Maximal 200 Todo-Eintraege sind erlaubt');
    }
    const invalidItem = noteData.todoItems.some(item => (
      !item ||
      typeof item !== 'object' ||
      typeof item.text !== 'string' ||
      item.text.length > 500 ||
      (item.completed !== undefined && typeof item.completed !== 'boolean') ||
      (item.order !== undefined && !Number.isInteger(item.order))
    ));
    if (invalidItem) throw clientError('Ungueltiger Todo-Eintrag');
  }

  if (noteData.linkPreviews !== undefined) {
    if (!Array.isArray(noteData.linkPreviews) || noteData.linkPreviews.length > 20) {
      throw clientError('Maximal 20 Link-Vorschauen sind erlaubt');
    }
    const invalidPreview = noteData.linkPreviews.some(preview => (
      !preview ||
      typeof preview !== 'object' ||
      typeof preview.url !== 'string' ||
      !isHttpUrl(preview.url) ||
      (preview.title !== undefined && (typeof preview.title !== 'string' || preview.title.length > 200)) ||
      (preview.description !== undefined && (typeof preview.description !== 'string' || preview.description.length > 500)) ||
      (preview.image && (typeof preview.image !== 'string' || !isHttpUrl(preview.image))) ||
      (preview.siteName !== undefined && (typeof preview.siteName !== 'string' || preview.siteName.length > 100))
    ));
    if (invalidPreview) throw clientError('Ungueltige Link-Vorschau');
  }

  // Erinnerung: null löscht, sonst muss ein parse-faehiger Zeitpunkt sein.
  // Vergangenheit ist erlaubt (Geraete-uhren gehen falsch, Import alter Daten)
  // — der Client entscheidet, was mit einer faelligen Erinnerung passiert.
  if (noteData.remindAt !== undefined && noteData.remindAt !== null) {
    if (noteData.remindAt instanceof Date) {
      if (Number.isNaN(noteData.remindAt.getTime())) throw clientError('Ungueltiger Erinnerungszeitpunkt');
    } else if (typeof noteData.remindAt !== 'string' || Number.isNaN(Date.parse(noteData.remindAt))) {
      throw clientError('Ungueltiger Erinnerungszeitpunkt');
    }
  }

  // Baum (v1.10.0): null = Wurzel, sonst ObjectId-Hex. Existenz, Eigentum und
  // Zyklusfreiheit prueft assertValidParent zum Zug-Zeitpunkt (create/update),
  // nicht hier — validateNoteFields ist synchron.
  if (noteData.parentId !== undefined && noteData.parentId !== null) {
    const validId = typeof noteData.parentId === 'string' && /^[0-9a-fA-F]{24}$/.test(noteData.parentId);
    if (!validId) throw clientError('parentId muss eine Notiz-ID oder null sein');
  }
  if (noteData.isCode !== undefined && typeof noteData.isCode !== 'boolean') {
    throw clientError('isCode muss ein Boolean sein');
  }
}

/**
 * Baum (v1.10.0): Legt fest, dass `parentId` eine eigene, nicht geloeschte
 * Notiz des Benutzers ist und dass die Notiz `noteId` (null beim Anlegen)
 * nicht bereits Vorfahre des neuen Eltern-Knotens ist — sonst entstuende ein
 * Zyklus, in dem kein Baum-Panel mehr eine Wurzel faende.
 * @param {string} userId - Besitzer (Eltern muessen dem Caller gehoeren)
 * @param {string|null} noteId - Die zu verschiebende/anzulegende Notiz
 * @param {string|null} parentId - Gewuenschter Eltern-Knoten (null = Wurzel)
 */
async function assertValidParent(userId, noteId, parentId) {
  if (parentId === undefined || parentId === null) return;

  let currentId = parentId;
  for (let depth = 0; depth < MAX_TREE_DEPTH; depth++) {
    if (noteId !== null && String(currentId) === String(noteId)) {
      throw clientError('Eine Notiz kann nicht unter sich selbst oder einem ihrer Nachkommen liegen');
    }
    const parent = await Note.findOne(
      { _id: currentId, userId, deletedAt: null },
      'parentId'
    ).lean();
    if (!parent) {
      throw clientError('Uebergeordnete Notiz nicht gefunden');
    }
    if (parent.parentId === null || parent.parentId === undefined) return;
    currentId = parent.parentId;
  }
  // Tiefen-Cap als zweites Netz unter dem Zyklus-Schutz: Ein Zyklus ueber
  // Import oder direkte DB-Manipulation kann nicht in eine Endloss-Schleife
  // laufen.
  throw clientError('Der Notiz-Baum ist zu tief verschachtelt');
}

/**
 * Kinder einer Notiz eine Ebene hochziehen (v1.10.0). Wird beim Loeschen
 * (Papierkorb und endgueltig) ausgefuehrt: Die Kinder sollen nicht mit in den
 * Papierkorb wandern — der Baum bleibt fuer alles andere unveraendert stehen.
 * @param {Object} note - Die gleich verschwindende Notiz (mit parentId)
 * @param {string} userId - Besitzer
 */
async function reparentChildren(note, userId) {
  await Note.updateMany(
    { userId, parentId: note._id, deletedAt: null },
    { $set: { parentId: note.parentId ?? null } }
  );
}

/** remindAt normalisieren: gueltiger Date oder null (loescht die Erinnerung). */
function normalizeRemindAt(value) {
  if (value === undefined || value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Helper function: Generate thumbnail for an uploaded image
 * @param {string} filename - Original image filename
 * @param {string} filepath - Full path to the original image
 * @returns {Promise<string>} Thumbnail filename
 */
async function generateThumbnail(filename, filepath) {
  try {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const thumbnailFilename = `${nameWithoutExt}-thumb.webp`;
    const thumbnailPath = path.join(path.dirname(filepath), thumbnailFilename);

    await sharp(filepath, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
      .resize(300, 300, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toFile(thumbnailPath);

    return thumbnailFilename;
  } catch (error) {
    console.error(`Error generating thumbnail for ${filename}:`, error);
    // Return empty string if thumbnail generation fails - we'll use original
    return '';
  }
}

async function validateImageDimensions(filepaths) {
  try {
    for (const filepath of filepaths) {
      const metadata = await sharp(filepath, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: 'error'
      }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
        throw new Error('image dimensions exceed limit');
      }
    }
  } catch (_) {
    throw clientError('Bildaufloesung ist ungueltig oder zu gross');
  }
}

/**
 * Helper function: Delete all images associated with a note from the filesystem
 * @param {Object} note - Note object with images array
 * @returns {Promise<void>}
 */
async function deleteNoteImages(note) {
  if (!note.images || note.images.length === 0) {
    return; // No images to delete
  }

  // Delete all images and thumbnails from filesystem
  const deletePromises = note.images.flatMap(image => {
    const promises = [];

    // Delete original image
    promises.push(new Promise((resolve) => {
      const filepath = path.join(imagesDir(), image.filename);
      fs.unlink(filepath, (err) => {
        if (err) {
          console.warn(`Warning: Could not delete image file ${image.filename}:`, err.message);
        }
        resolve();
      });
    }));

    // Delete thumbnail if it exists
    if (image.thumbnailFilename) {
      promises.push(new Promise((resolve) => {
        const thumbpath = path.join(imagesDir(), image.thumbnailFilename);
        fs.unlink(thumbpath, (err) => {
          if (err) {
            console.warn(`Warning: Could not delete thumbnail ${image.thumbnailFilename}:`, err.message);
          }
          resolve();
        });
      }));
    }

    return promises;
  });

  await Promise.all(deletePromises);
}

/**
 * Helper: Delete all file attachments of a note from the filesystem.
 * @param {Object} note - Note object with files array
 * @returns {Promise<void>}
 */
async function deleteNoteFiles(note) {
  if (!note.files || note.files.length === 0) {
    return;
  }
  await Promise.all(note.files.map((file) => new Promise((resolve) => {
    fs.unlink(path.join(filesDir(), file.filename), (err) => {
      if (err) {
        console.warn(`Warning: Could not delete attachment ${file.filename}:`, err.message);
      }
      resolve();
    });
  })));
}

/**
 * Build query for fetching notes
 * @param {Object} params - Query parameters
 * @param {string} params.userId - User ID
 * @param {string} params.search - Search term
 * @param {string} params.tag - Tag filter
 * @param {boolean} params.isArchived - Archived filter
 * @returns {Object} MongoDB query object
 */
function buildNotesQuery({ userId, search, tag, isArchived = false, deleted = false }) {
  // Query for own and shared notes
  let query = {
    $or: [
      { userId: userId }, // Own notes
      { sharedWith: userId } // Shared notes
    ],
    isArchived: isArchived,
    // Papierkorb: gelöschte Notizen tauchen in keiner regulären Ansicht auf.
    deletedAt: deleted ? { $ne: null } : null
  };

  // Full-text search using MongoDB text index (more performant than regex)
  if (typeof search === 'string' && search.trim() !== '') {
    // MongoDB $text search is indexed and much faster than regex
    // It searches in title, content, and todoItems.text (as defined in the model)
    query.$text = { $search: search.trim() };
  }

  // Filter by tag (case-insensitive to match tags regardless of stored casing)
  if (typeof tag === 'string' && tag.trim() !== '') {
    query.tags = { $regex: new RegExp(`^${tag.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
  }

  return query;
}

/**
 * Get all notes with optional filtering and pagination
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Notes and pagination info
 */
async function getAllNotes({ userId, search, tag, page = 1, limit = 50, archived = 'false', deleted = 'false', folderId, since, includeMeta = true } = {}) {
  const safePage = normalizePositiveInteger(page, 1, Number.MAX_SAFE_INTEGER);
  const safeLimit = normalizePositiveInteger(limit, 50, 100);
  const isArchived = archived === true || archived === 'true';
  const isDeleted = deleted === true || deleted === 'true';
  // includeMeta=false (v1.14.0): Counts + Tag-Cloud weglassen. Der Aufruf war
  // sechs Queries stark (4x countDocuments + Tag-Aggregation + Find) und
  // wiederholte die globalen Counts auf jeder Folgeseite, obwohl sie dort
  // niemand auswertet — Android-Paging ab Seite 2 und v1-Clients (deren
  // Antwort counts/tags ohnehin nie enthielt) zahlen sie jetzt nicht mehr mit.
  const withMeta = !(includeMeta === false || includeMeta === 'false');

  // Delta-Sync (v1.13.0): Nur Dokumente mit updatedAt > since. Ungültige Werte
  // sind 400er, kein stillses Ignorieren — sonst cached ein Client einen
  // Zeitstempel, den der Server nie wieder versteht. Counts bleiben global.
  let sinceDate = null;
  if (since !== undefined && since !== null && String(since).trim() !== '') {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw clientError('since muss ein ISO-8601-Zeitpunkt sein');
    }
  }

  // Papierkorb: nur eigene Notizen, unabhängig vom Archiv-Status, zuletzt
  // gelöschte zuerst. Suche/Tag-Filter bleiben verfügbar; `since` filtert hier
  // auf deletedAt (der Delta-Stempel der Ansicht ist der Löschzeitpunkt, nicht
  // updatedAt) — bis v1.15 wurden since und tag in diesem Zweig still
  // ignoriert, obwohl der Parser oben ungültige since-Werte mit 400 ablehnte.
  if (isDeleted) {
    const trashQuery = {
      userId,
      deletedAt: sinceDate ? { $gt: sinceDate } : { $ne: null },
      ...(typeof search === 'string' && search.trim() !== '' ? { $text: { $search: search.trim() } } : {})
    };
    if (typeof tag === 'string' && tag.trim() !== '') {
      // Gleiches case-insensitive Exakt-Matching wie buildNotesQuery (v1.15.0).
      trashQuery.tags = { $regex: new RegExp(`^${tag.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    }
    const skip = (safePage - 1) * safeLimit;
    // includeMeta=false (v1.14.0): Folgeseiten brauchen die globalen Zähler
    // nicht — die Sidebar hat sie von Seite 1. Spart zwei countDocuments.
    const [trashTotal, trashNotes, activeCount, archivedCount] = await Promise.all([
      Note.countDocuments(trashQuery),
      Note.find(trashQuery)
        .select('-revisions')
        .populate('userId', 'username email')
        .populate('sharedWith', 'username email')
        .sort({ deletedAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      withMeta
        ? Note.countDocuments(buildNotesQuery({ userId, isArchived: false }))
        : null,
      withMeta
        ? Note.countDocuments(buildNotesQuery({ userId, isArchived: true }))
        : null
    ]);

    if (!withMeta) {
      return {
        notes: trashNotes,
        pagination: {
          page: safePage,
          limit: safeLimit,
          total: trashTotal,
          pages: Math.ceil(trashTotal / safeLimit)
        }
      };
    }

    return {
      notes: trashNotes,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: trashTotal,
        pages: Math.ceil(trashTotal / safeLimit)
      },
      counts: { active: activeCount, archived: archivedCount, trash: trashTotal },
      tags: []
    };
  }

  const query = buildNotesQuery({ userId, search, tag, isArchived });
  const activeQuery = buildNotesQuery({ userId, isArchived: false });
  const archivedQuery = buildNotesQuery({ userId, isArchived: true });

  // Ordner-Scope (v1.11.1): serverseitig filtern statt im Client — der Client
  // filterte nur das geladene 50er-Fenster, was ab ein paar hundert Notizen
  // leere Ordneransichten zeigte (Trilium-Import: Seite 1 voller Kind-Notizen,
  // Hauptebene leer). 'root' = Hauptebene, sonst die direkten Kinder des
  // Knotens. Counts und Tag-Cloud bleiben global (Sidebar-Badges); die
  // Sichtbarkeit regelt die normale eigene-und-geteilte-Query — ein fremder
  // Ordner liefert also nur Notizen, die eh schon geteilt sind.
  if (folderId === 'root') {
    query.parentId = null;
  } else if (typeof folderId === 'string' && folderId !== '') {
    if (!/^[a-f0-9]{24}$/i.test(folderId)) {
      throw clientError('folderId muss „root" oder eine Notiz-ID sein');
    }
    query.parentId = folderId;
  }

  if (sinceDate) {
    // $gte statt $gt (Review v1.14.0): updatedAt hat Millisekunden-Aufloesung
    // und Bulk-Operationen (z. B. Tag-Rename) schreiben HUNDERTEN Notizen
    // denselben Zeitstempel. Ein striktes $gt ueberspringt eine Notiz, die im
    // selben Millisekunden-Tick wie der Cursor geaendert wurde, dauerhaft —
    // der Client-Upsert ist idempotent, Redelivery der Grenz-Zeilen ist
    // daher billiger als ihr stiller Verlust.
    query.updatedAt = { $gte: sinceDate };
  }

  const searchTerm = typeof search === 'string' ? search.trim() : '';
  const isSearch = searchTerm !== '';

  // Tag-Counts zählen dieselbe Sicht wie die Liste — bei aktiver Suche also nur
  // Treffer. Vorher zeigte die Sidebar die Gesamtzahlen, während die Liste nur
  // Suchergebnisse enthielt.
  const tagMatch = isArchived ? { ...archivedQuery } : { ...activeQuery };
  if (isSearch) {
    tagMatch.$text = { $search: searchTerm };
  }

  const skip = (safePage - 1) * safeLimit;
  // total ist Teil der Pagination und bleibt immer; die drei globalen Counts
  // und die Tag-Aggregation fallen bei includeMeta=false weg (siehe oben).
  const [total, activeCount, archivedCount, trashCount, tags] = await Promise.all([
    Note.countDocuments(query),
    withMeta ? Note.countDocuments(activeQuery) : null,
    withMeta ? Note.countDocuments(archivedQuery) : null,
    withMeta ? Note.countDocuments({ userId, deletedAt: { $ne: null } }) : null,
    withMeta
      ? Note.aggregate([
        { $match: tagMatch },
        // Nur das tags-Feld weiterreichen (v1.15.0): $unwind laeuft sonst
        // ueber ganze Dokumente inklusive Volltext und Revisions-Historie.
        { $project: { tags: 1 } },
        { $unwind: '$tags' },
        // Case-insensitiv gruppieren wie Tag-Filter und Tag-Operationen
        // (v1.15.0): "Projekt"/"projekt" sind ein Chip mit ehrlicher Zahl,
        // nicht zwei Chips mit widersprechenden Zaehlungen.
        { $group: { _id: { $toLower: '$tags' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, name: '$_id', count: 1 } }
      ])
      : null
  ]);

  // Bei einer Suche zählt Relevanz (gewichteter textScore) mehr als Recency;
  // angeheftete Notizen bleiben oben. Ohne Suche gilt die gewohnte Ordnung.
  // revisions ist bewusstprojiziert weg (v1.14.0): Bis zu 10 Volltext-Snapshots
  // pro Notiz reisten in jeder Listen-Antwort mit, die kein Client liest — die
  // Historie hat ihre eigenen Endpunkte (/revisions, /revisions?at=, Restore).
  // $meta-Projektion + Feld-Ausschluss sind in MongoDB kombinierbar.
  const listQuery = isSearch
    ? Note.find(query, { score: { $meta: 'textScore' } })
    : Note.find(query);
  const notes = await listQuery
    .select('-revisions')
    .populate('userId', 'username email')
    .populate('sharedWith', 'username email')
    .populate('lastEditedBy', 'username')
    // Same recency key the client uses to order a page (useNotesManager sorts by
    // updatedAt): sorting by createdAt here made recently edited older notes
    // land on later pages, so the visible order contradicted the pagination.
    .sort(isSearch
      ? { isPinned: -1, score: { $meta: 'textScore' } }
      : { isPinned: -1, order: -1, updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(safeLimit);

  if (!withMeta) {
    return {
      notes,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit)
      }
    };
  }

  return {
    notes,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit)
    },
    counts: { active: activeCount, archived: archivedCount, trash: trashCount },
    tags
  };
}
/**
 * Get a single note by ID
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Note object
 * @throws {Error} If note not found or no access
 */
async function getNoteById(noteId, userId) {
  const note = await Note.findOne({
    _id: noteId,
    deletedAt: null,
    $or: [
      { userId: userId },
      { sharedWith: userId }
    ]
  }).populate('userId', 'username email')
    .populate('sharedWith', 'username email')
    .populate('lastEditedBy', 'username')
    // Wie die Liste: Die Detail-Antwort trägt die Historie nicht mit —
    // GET /:id/revisions liefert sie bewusst als Metadaten (v1.13.0).
    .select('-revisions');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Note the user may edit: own or shared with them. Used for uploads and
 * transcription, which collaborators may perform on a shared note.
 * @param {string} noteId
 * @param {string} userId
 * @returns {Promise<Object>}
 */
async function getEditableNoteById(noteId, userId) {
  const note = await Note.findOne(noteEditQuery(noteId, userId));
  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }
  return note;
}

/**
 * Create a new note
 * @param {Object} noteData - Note data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Created note
 */
async function createNote(noteData, userId) {
  validateNoteFields(noteData);
  const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews, remindAt, parentId, isCode } = noteData;
  const normalizedIsTodoList = isTodoList === true;
  const normalizedContent = normalizedIsTodoList ? '' : (typeof content === 'string' ? content.trim() : '');
  const normalizedTodoItems = normalizedIsTodoList && Array.isArray(todoItems) ? todoItems : [];

  validateNoteContent({
    isTodoList: normalizedIsTodoList,
    todoItems: normalizedTodoItems,
    content: normalizedContent
  });

  // Baum: Existenz/Eigentum/Zyklusfreiheit des Eltern-Knotens (null = Wurzel).
  // Vor der Notiz-Anlage, damit ein kaputter Import keine Waisen erzeugt.
  await assertValidParent(userId, null, parentId);

  // Manuelle Reihenfolge: Sobald in einem Abschnitt (angeheftet / sonstige)
  // einmal per Drag & Drop sortiert wurde, gehören neue Notizen nach oben.
  // Vorher bleibt order 0 und updatedAt entscheidet — also exakt das bisherige
  // Verhalten, ganz ohne Migration.
  const nextOrder = await nextTopOrder(userId, isPinned === true);

  const newNote = new Note({
    title: title || '',
    content: normalizedContent,
    color: color || '#ffffff',
    isPinned: isPinned || false,
    tags: tags || [],
    isTodoList: normalizedIsTodoList,
    todoItems: normalizedTodoItems,
    linkPreviews: linkPreviews || [],
    order: nextOrder,
    remindAt: normalizeRemindAt(remindAt),
    parentId: parentId ?? null,
    isCode: isCode === true,
    userId: userId
  });

  const savedNote = await newNote.save();
  return savedNote;
}

/**
 * Order value for a new note: 0 while the section has never been sorted
 * manually, otherwise one above the current top so it lands first.
 * @param {string} userId
 * @param {boolean} isPinned
 * @returns {Promise<number>}
 */
async function nextTopOrder(userId, isPinned) {
  const top = await Note.findOne({
    userId,
    isPinned,
    isArchived: false,
    deletedAt: null,
    order: { $gt: 0 }
  }).sort({ order: -1 }).select('order');

  return top ? top.order + 1 : 0;
}

const MAX_REORDER_IDS = 200;
/** Obergrenze für order: int32-sicher, weit jenseits jeder realen Notizanzahl. */
const MAX_ORDER_VALUE = 2147483647;

/**
 * Persist a manual order (drag & drop).
 *
 * The client sends the ids of one section in their new sequence — typically the
 * currently visible page. The server reuses the existing order values of exactly
 * those notes (highest value to the first id), so notes outside the payload keep
 * their relative position and a page-local reorder cannot scramble other pages.
 *
 * @param {string} userId - owner
 * @param {string[]} orderedIds - note ids, top first
 * @returns {Promise<{updated: number}>}
 */
async function reorderNotes(userId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw clientError('orderedIds muss ein nicht-leeres Array sein');
  }
  if (orderedIds.length > MAX_REORDER_IDS) {
    throw clientError(`Maximal ${MAX_REORDER_IDS} Notizen pro Sortiervorgang`);
  }

  const uniqueIds = [];
  const seen = new Set();
  for (const id of orderedIds) {
    const key = String(id);
    if (!mongoose.Types.ObjectId.isValid(key) || seen.has(key)) continue;
    seen.add(key);
    uniqueIds.push(key);
  }
  if (uniqueIds.length === 0) {
    throw clientError('Keine gültigen Notiz-IDs');
  }

  const notes = await Note.find({ userId, deletedAt: null, _id: { $in: uniqueIds } })
    .select('order isPinned isArchived')
    .lean();

  // Nur eigene Notizen; fremde/ungefundene Ids fliegen raus statt den Vorgang
  // abzubrechen (geteilte Notizen gehören dem Besitzer).
  const sortable = new Map(notes.map(note => [String(note._id), note]));
  const ids = uniqueIds.filter(id => sortable.has(id));
  if (ids.length === 0) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  // Bestehende Order-Werte der beteiligten Notizen absteigend wiederverwenden.
  // Sind sie alle gleich (z. B. 0 = noch nie sortiert), wird ein frischer Block
  // über dem bisherigen Maximum des Abschnitts vergeben.
  const existing = ids.map(id => sortable.get(id).order || 0).sort((a, b) => b - a);
  const allEqual = existing.every(value => value === existing[0]);

  let values;
  if (allEqual) {
    const first = sortable.get(ids[0]);
    const highest = await Note.findOne({
      userId,
      isPinned: first.isPinned,
      isArchived: first.isArchived,
      deletedAt: null
    }).sort({ order: -1 }).select('order').lean();
    const top = Math.max(highest?.order || 0, 0) + ids.length;
    values = ids.map((_id, index) => top - index);
  } else {
    values = existing;
  }

  const operations = ids.map((id, index) => ({
    updateOne: {
      filter: { _id: id, userId, deletedAt: null },
      update: { $set: { order: values[index] } }
    }
  }));

  const result = await Note.bulkWrite(operations);
  return { updated: result.modifiedCount ?? ids.length };
}

/**
 * Update an existing note
 * @param {string} noteId - Note ID
 * @param {Object} noteData - Updated note data
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Updated note
 * @throws {Error} If note not found or no access
 */
async function updateNote(noteId, noteData, userId) {
  validateNoteFields(noteData);
  const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews, remindAt, order, parentId, isCode, isArchived } = noteData;

  // Manuelle Reihenfolge: Vor diesem Fix wurde ein mitgeschicktes `order`
  // stillschweigend verworfen (nicht destrukturiert) — Sync-Scripts hatten
  // keine Chance, eine Position ohne Sammel-Reorder zu setzen. Validiert vor
  // dem DB-Lesen, damit ein kaputtes `order` nicht als 404 durchgeht.
  if (order !== undefined && (!Number.isInteger(order) || order < 0 || order > MAX_ORDER_VALUE)) {
    throw clientError(`order muss eine ganze Zahl zwischen 0 und ${MAX_ORDER_VALUE} sein`);
  }

  const note = await Note.findOne(noteEditQuery(noteId, userId));
  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  // Baum × Teilen (v1.13.0): Struktur ist Besitzer-Sache. updateNote laeuft
  // ueber noteEditQuery ($or sharedWith) — ein Mitbearbeiter konnte bisher die
  // fremde Notiz an eigene Knoten haengen, weil assertValidParent gegen die
  // EDITOR-Id pruefte. Damit verschwand sie aus dem Baum des Besitzers, dessen
  // Baum die Eltern-Ids des Editors nicht kennt. Eltern werden jetzt gegen
  // den BESITZER validiert; Mitbearbeiter duerfen parentId/order nicht veraendern
  // (mitgeschickte unveränderte Werte sind no-ops, damit Clients, die das
  // komplette Objekt senden, keine 403er kassieren).
  const isOwner = String(note.userId) === String(userId);
  let effectiveParentId = parentId;
  let effectiveOrder = order;
  let effectiveIsArchived = isArchived;
  if (!isOwner) {
    if (parentId !== undefined && (parentId ?? null) !== (note.parentId ?? null)) {
      throw clientError('Nur der Besitzer kann die Notiz im Baum verschieben');
    }
    // Archivieren bleibt Besitzer-Sache (wie toggleArchiveNote, das ohne
    // noteEditQuery laeuft): Ein Mitbearbeiter soll nicht entscheiden, dass
    // die Notiz aus der aktiven Ansicht des Besitzers verschwindet. Ein
    // mitgeschickter unveränderter Wert ist ein No-Op — Clients, die das
    // komplette Objekt senden, kassieren deshalb keinen 403er.
    if (isArchived !== undefined && isArchived !== Boolean(note.isArchived)) {
      throw clientError('Nur der Besitzer kann die Notiz archivieren');
    }
    effectiveParentId = undefined;
    effectiveOrder = undefined;
    effectiveIsArchived = undefined;
  }

  // Baum: Verschieben nur auf eigene, nicht geloeschte Eltern ohne Zyklus.
  // null loest die Notiz vom Baum (Wurzel), undefined laesst sie unangetastet.
  if (effectiveParentId !== undefined) {
    await assertValidParent(note.userId, noteId, effectiveParentId);
  }

  // Optimistic locking: baseUpdatedAt is the updatedAt of the note version
  // the client based its edit on. If the stored note changed more than the
  // timestamp tolerance ago, the edit is stale and must not overwrite the
  // newer version. baseUpdatedAt itself is never persisted: only the fields
  // destructured above are ever assigned to the document.
  const baseUpdatedAt = parseBaseUpdatedAt(noteData.baseUpdatedAt);
  const storedUpdatedAt = note.updatedAt ? new Date(note.updatedAt) : null;
  if (
    baseUpdatedAt &&
    storedUpdatedAt &&
    storedUpdatedAt.getTime() - baseUpdatedAt.getTime() > CONFLICT_TOLERANCE_MS
  ) {
    throwNoteConflict(note);
  }

  const nextIsTodoList = isTodoList !== undefined ? isTodoList : note.isTodoList;
  const nextTodoItems = todoItems !== undefined ? todoItems : note.todoItems;
  const nextContent = content !== undefined
    ? (nextIsTodoList ? '' : (content?.trim() || ''))
    : (nextIsTodoList ? '' : note.content);

  validateNoteContent({
    isTodoList: nextIsTodoList,
    todoItems: nextTodoItems,
    content: nextContent
  });

  const $set = {};
  if (title !== undefined) $set.title = title;
  if (color !== undefined) $set.color = color;
  if (isPinned !== undefined) $set.isPinned = isPinned;
  if (tags !== undefined) $set.tags = tags;
  if (linkPreviews !== undefined) $set.linkPreviews = linkPreviews;
  if (isTodoList !== undefined) $set.isTodoList = isTodoList;

  if (content !== undefined || isTodoList !== undefined) {
    $set.content = nextContent;
  }

  if (todoItems !== undefined || isTodoList !== undefined) {
    $set.todoItems = nextIsTodoList ? nextTodoItems : [];
  }

  // Erinnerung setzen oder loeschen (null). Explizit mit $set, damit
  // normalizeRemindAt(undefined) hier nie ankommt — undefined wuerde das Feld
  // unangetastet lassen, was genau dem entspricht, was der Client will.
  if (remindAt !== undefined) {
    $set.remindAt = normalizeRemindAt(remindAt);
  }

  // Manuelle Reihenfolge per Einzel-Update (Validierung oben, vor dem Lesen).
  // Beim Anlegen bleibt es dabei, dass der Server selbst an die Spitze des
  // Abschnitts sortiert (nextTopOrder-Invariante in createNote).
  if (effectiveOrder !== undefined) {
    $set.order = effectiveOrder;
  }

  // Baum + Code-Notiz (v1.10.0): undefined laesst beide unangetastet; null
  // loest die Notiz vom Baum. assertValidParent lief oben bereits.
  if (effectiveParentId !== undefined) {
    $set.parentId = effectiveParentId ?? null;
  }
  if (isCode !== undefined) {
    $set.isCode = isCode;
  }
  // Idempotentes Archivieren per PUT (v1.15.0): Die Bulk-Auswahl des Clients
  // kann den IST-Zustand fensterfremder Notizen nicht kennen — ein Toggle
  // ($not) haette den vorhandenen Zustand UMGEKEHRT. Der Besitzer-Gate steht
  // weiter oben.
  if (effectiveIsArchived !== undefined) {
    $set.isArchived = effectiveIsArchived;
  }

  // Nachvollziehbarkeit bei geteilten Notizen: Wer hat zuletzt geändert?
  $set.lastEditedBy = userId;

  // Historie (v1.13.0): Die UEBERSCHRIEBENE Fassung snapshotten — nur wenn
  // sich content/title/todoItems wirklich aendern, sonst frisst ein re-Save
  // (Autosave, Sync) die zehn Slots mit identischen Kopien leer. $push+$slice
  // in derselben findOneAndUpdate: Snapshot und Edit sind atomar, ein
  // paralleler Schreiber kann keine Fassung verlieren.
  const previousTitle = note.title || '';
  const previousContent = note.content || '';
  const nextTitleForCompare = title !== undefined ? title : previousTitle;
  const titleChanged = nextTitleForCompare !== previousTitle;
  const contentChanged = (content !== undefined || isTodoList !== undefined) && nextContent !== previousContent;
  const todoChanged = (todoItems !== undefined || isTodoList !== undefined)
    && JSON.stringify(nextTodoItems || []) !== JSON.stringify(note.todoItems || []);
  const $pushRevision = (titleChanged || contentChanged || todoChanged)
    ? {
        revisions: {
          $each: [{
            title: previousTitle,
            content: previousContent,
            isTodoList: note.isTodoList === true,
            todoItems: note.todoItems || [],
            savedAt: note.updatedAt || new Date(),
            editorId: note.lastEditedBy || note.userId
          }],
          $slice: -REVISIONS_LIMIT
        }
      }
    : undefined;

  // Bedingtes Schreiben: Das beim Lesen vorgefundene updatedAt ist der
  // Version-Token. Hat zwischen Lesen und Schreiben ein zweiter Schreibender
  // gewonnen, liefert findOneAndUpdate null — dann ist das ein 409 mit dem
  // frischen Server-Stand, kein stiller Überschreib-Sieg und kein 500er
  // (VersionError) wie beim früheren unbedingten save().
  const updatedAtPrecondition = storedUpdatedAt || undefined;
  const updatedNote = await Note.findOneAndUpdate(
    {
      ...noteEditQuery(noteId, userId),
      ...(updatedAtPrecondition && { updatedAt: updatedAtPrecondition })
    },
    $pushRevision ? { $set, $push: $pushRevision } : { $set },
    { new: true, projection: { revisions: 0 }, runValidators: true }
  );

  if (!updatedNote) {
    const fresh = await Note.findOne(noteEditQuery(noteId, userId));
    if (!fresh) {
      const error = new Error(errorMessages.NOTES.NOT_FOUND);
      error.statusCode = 404;
      throw error;
    }
    throwNoteConflict(fresh);
  }

  return updatedNote;
}

/**
 * Delete a note — weich: Die Notiz wandert in den Papierkorb (30 Tage) und kann
 * wiederhergestellt werden. Bilddateien bleiben deshalb liegen; endgültig
 * gelöscht wird erst über purgeNote/emptyTrash oder den TTL-Index.
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} The soft-deleted note
 * @throws {Error} If note not found or no access
 */
async function deleteNote(noteId, userId) {
  const note = await Note.findOneAndUpdate(
    { _id: noteId, userId, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { new: true, projection: { revisions: 0 } }
  );

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  // Baum: Die Kinder wandern eine Ebene hoch — sie sollen nicht mit in den
  // Papierkorb verschwinden, nur weil ihr Ordner geloescht wurde.
  await reparentChildren(note, userId);

  return note;
}

/**
 * Restore a note from the trash.
 * @param {string} noteId
 * @param {string} userId - owner
 * @returns {Promise<Object>} The restored note
 */
async function restoreNote(noteId, userId) {
  const note = await Note.findOneAndUpdate(
    { _id: noteId, userId, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { new: true, projection: { revisions: 0 } }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Permanently delete a note from the trash, including its image files.
 * @param {string} noteId
 * @param {string} userId - owner
 * @returns {Promise<Object>} The removed note
 */
async function purgeNote(noteId, userId) {
  // Nur Notizen, die bereits im Papierkorb liegen, dürfen endgültig weg.
  const note = await Note.findOneAndDelete({
    _id: noteId,
    userId,
    deletedAt: { $ne: null }
  });

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  // Baum: Auch beim Endloeschen die Kinder eine Ebene hochziehen, bevor der
  // Knoten verschwindet (sonst zeigten sie auf eine nicht mehr existente Notiz).
  await reparentChildren(note, userId);

  await deleteNoteImages(note);
  await deleteNoteFiles(note);
  return note;
}

/**
 * Empty the trash: remove every soft-deleted note of the user plus their files.
 * @param {string} userId
 * @returns {Promise<number>} Count of permanently removed notes
 */
async function emptyTrash(userId) {
  const notes = await Note.find({ userId, deletedAt: { $ne: null } }).select('images files parentId');
  if (notes.length === 0) {
    return 0;
  }

  // Baum: Kinder jedes endgueltig geloeschten Knotens eine Ebene hochziehen
  // (vor dem deleteMany — danach waere die Eltern-Notiz fuer den Blick nach
  // oben weg und die Kinder haengen im Leeren).
  for (const note of notes) {
    await reparentChildren(note, userId);
  }

  // Mengentreu: gelöscht wird genau die gelesene Menge (plus erneutes
  // deletedAt-Prädikat). Nach Prädikat allein zu löschen erwischte auch Notizen,
  // die zwischen Find und Delete in den Papierkorb wanderten — deren Dokumente
  // wären weg, ihre Dateien für immer verwaist.
  const deleted = await Note.deleteMany({
    _id: { $in: notes.map((note) => note._id) },
    userId,
    deletedAt: { $ne: null }
  });
  await Promise.all(notes.map(note => Promise.all([deleteNoteImages(note), deleteNoteFiles(note)])));
  return deleted.deletedCount ?? notes.length;
}

/**
 * Billige Aenderungs-Sonde fuer den 60s-Poll (v1.13.0): Eine Aggregation
 * liefert die Zaehlungen plus max(updatedAt). Der Client haelt den letzten
 * Stand im Speicher und ueberspringt Liste+Baum komplett, wenn sich nichts
 * geaendert hat — vorher lud jeder sichtbare Tab pro Tick eine volle 50er-
 * Seite inklusive 5 paralleler DB-Queries plus den kompletten Baum.
 * Bucket-Semantik exakt wie getAllNotes: aktiv/archiviert ueber eigene-und-
 * geteilte, Papierkorb nur eigene Notizen. deletedAt/isArchived fehlen bei
 * direkt importierten Dokumenten — $ifNull macht sie vergleichbar.
 */
async function getNotesMeta(userId) {
  const ownerId = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(String(userId)) : userId;
  const [row] = await Note.aggregate([
    { $match: { $or: [{ userId: ownerId }, { sharedWith: ownerId }] } },
    // $project vor $group (v1.15.0): Ohne diese Stufe scannte die 60s-Sonde
    // VOLLTEXT-Dokumente — content bis 10 KB, todoItems, bis zu 10 Revisions-
    // Snapshots. Die Zaehlung braucht vier Felder, kein Dokument-Material.
    { $project: { deletedAt: 1, isArchived: 1, userId: 1, updatedAt: 1 } },
    { $group: {
      _id: null,
      active: { $sum: { $cond: [{ $and: [
        { $eq: [{ $ifNull: ['$deletedAt', null] }, null] },
        { $eq: [{ $ifNull: ['$isArchived', false] }, false] }
      ] }, 1, 0] } },
      archived: { $sum: { $cond: [{ $and: [
        { $eq: [{ $ifNull: ['$deletedAt', null] }, null] },
        { $eq: [{ $ifNull: ['$isArchived', false] }, true] }
      ] }, 1, 0] } },
      trash: { $sum: { $cond: [{ $and: [
        { $ne: [{ $ifNull: ['$deletedAt', null] }, null] },
        { $eq: ['$userId', ownerId] }
      ] }, 1, 0] } },
      maxUpdatedAt: { $max: '$updatedAt' }
    } }
  ]);
  return {
    active: row?.active ?? 0,
    archived: row?.archived ?? 0,
    trash: row?.trash ?? 0,
    maxUpdatedAt: row?.maxUpdatedAt ?? null
  };
}

/**
 * Revisionsliste einer Notiz (v1.13.0): Metadaten ohne Volltexte — zehnmal
 * 10 KB Inhalt pro Abruf waere Payload ohne Ende. Den Volltext einer Fassung
 * liefert getNoteRevision(savedAt); Restore laeuft ueber denselben Schluessel,
 * NICHT ueber den Array-Index ($slice verschiebt Indizes).
 */
async function getNoteRevisions(noteId, userId) {
  const note = await Note.findOne(noteEditQuery(noteId, userId)).select('revisions');
  if (!note) {
    throw notFoundError();
  }
  return (note.revisions || [])
    .map((revision) => ({
      savedAt: revision.savedAt,
      editorId: revision.editorId ?? null,
      title: revision.title || '',
      isTodoList: revision.isTodoList === true,
      contentLength: (revision.content || '').length,
      todoCount: (revision.todoItems || []).length
    }))
    .reverse(); // neueste zuerst: angehaengt wird hinten
}

/** Volltext einer Fassung (fuer die Vorschau vor dem Restore). */
async function getNoteRevision(noteId, userId, savedAt) {
  const note = await Note.findOne(noteEditQuery(noteId, userId)).select('revisions');
  if (!note) {
    throw notFoundError();
  }
  const revision = (note.revisions || []).find((entry) => sameSavedAt(entry.savedAt, savedAt));
  if (!revision) {
    const error = new Error('Revision nicht gefunden');
    error.statusCode = 404;
    throw error;
  }
  return {
    savedAt: revision.savedAt,
    editorId: revision.editorId ?? null,
    title: revision.title || '',
    content: revision.content || '',
    isTodoList: revision.isTodoList === true,
    todoItems: revision.todoItems || []
  };
}

/** savedAt-Vergleich: Client schickt genau das zurueck, was die Liste lieferte. */
function sameSavedAt(stored, requested) {
  if (!stored || !requested) return false;
  return String(stored) === String(requested) || new Date(stored).getTime() === new Date(requested).getTime();
}

function notFoundError() {
  const error = new Error(errorMessages.NOTES.NOT_FOUND);
  error.statusCode = 404;
  return error;
}

/**
 * Fassung wiederherstellen (v1.13.0): laeuft als normales updateNote — der
 * aktuelle Stand wird dadurch selbst zur juengsten Revision (Undo des Undo
 * funktioniert), Konfliktbehandlung und lastEditedBy inklusive.
 */
async function restoreNoteRevision(noteId, userId, savedAt) {
  const revision = await getNoteRevision(noteId, userId, savedAt);
  return updateNote(noteId, {
    title: revision.title,
    content: revision.content,
    todoItems: revision.todoItems,
    isTodoList: revision.isTodoList
  }, userId);
}

/**
 * Baum-Übersicht (v1.10.0): Leichte Projektion aller aktiven und archivierten
 * Notizen — alles, was ein Baum-Panel braucht, ohne Inhalte und Bilder. Der
 * Client verschachtelt die Liste selbst; ein Server-seitiger Baum waere nur
 * eine teurere Art, dasselbe JSON zu liefern.
 * @param {string} userId
 * @returns {Promise<Array>} Flache Liste mit _id, parentId, title, order, Flags
 */
async function getNoteTree(userId, since) {
  // Seit v1.13.0 inklusive geteilter Notizen ($or sharedWith): Die Liste
  // zeigte sie schon laengst, der Baum liess sie unsichtbar. `shared`
  // markiert fremde Knoten; deren Eltern (Notizen des Besitzers) fehlen in
  // dieser Sicht, der Client haengt Verwaiste an die Wurzel.
  // since (v1.13.0): nur geaenderte Knoten — der 60s-Poll eines zweiten Tabs
  // laedt sonst den kompletten Baum, egal ob sich etwas tat.
  let sinceDate = null;
  if (since !== undefined && since !== null && String(since).trim() !== '') {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw clientError('since muss ein ISO-8601-Zeitpunkt sein');
    }
  }
  const notes = await Note.find({
    $or: [{ userId }, { sharedWith: userId }],
    deletedAt: null,
    // $gte aus demselben Grund wie im Listing (s. dort): Bulk-Timestamps.
    ...(sinceDate ? { updatedAt: { $gte: sinceDate } } : {})
  })
    .select('parentId title order isPinned isCode isArchived isTodoList remindAt updatedAt userId')
    .sort({ isPinned: -1, order: -1, updatedAt: -1 })
    .lean();

  return notes.map((note) => ({
    id: note._id,
    parentId: note.parentId ?? null,
    title: note.title || '',
    order: note.order || 0,
    isPinned: note.isPinned === true,
    isCode: note.isCode === true,
    isArchived: note.isArchived === true,
    isTodoList: note.isTodoList === true,
    remindAt: note.remindAt ?? null,
    updatedAt: note.updatedAt,
    shared: String(note.userId) !== String(userId)
  }));
}

// Backlinks (v1.16.0): Cap für „Erwähnt in“ — die Liste ist eine Navigations-
// Hilfe im Modal, keine Volltextrecherche. 50 wie überall.
const BACKLINKS_LIMIT = 50;

/**
 * Notizen, die diese Notiz per Wiki-Link `[[Titel]]` erwähnen (v1.16.0).
 *
 * Bis v1.15 rechnete der Web-Client das im geladenen 50er-Fenster aus — bei
 * vollem Korpus (Trilium-Import: hunderte Notizen) zeigte „Erwähnt in“ fast
 * immer eine leere oder falsche Liste. Der Server sucht über das echte Korpus:
 * eigene + geteilte, nicht gelöschte, nicht archivierte Notizen, deren Inhalt
 * den Titel in Doppelklammern trägt — case-insensitiv, weil importierte
 * Bestände gemischte Schreibweisen tragen (der Link-Resolver im Editor ist
 * exakt, die Erwähnung ist aber trotzdem eine).
 *
 * @param {string} noteId - die erwähnte Notiz
 * @param {string} userId - Caller (Sichtbarkeit: eigene + geteilte Notizen)
 * @returns {Promise<Array>} [{ id, title, updatedAt }] — neueste zuerst, max. 50
 */
async function getNoteBacklinks(noteId, userId) {
  const note = await Note.findOne(noteEditQuery(noteId, userId)).select('title').lean();
  if (!note) {
    throw notFoundError();
  }
  const title = (note.title || '').trim();
  if (!title) return [];

  const mentioned = await Note.find({
    $or: [{ userId }, { sharedWith: userId }],
    deletedAt: null,
    isArchived: false,
    _id: { $ne: noteId },
    content: { $regex: new RegExp(`\\[\\[${escapeRegexLiteral(title)}\\]\\]`, 'i') }
  })
    .select('title updatedAt')
    .sort({ updatedAt: -1 })
    .limit(BACKLINKS_LIMIT)
    .lean();

  return mentioned.map((source) => ({
    id: source._id,
    title: source.title || '',
    updatedAt: source.updatedAt ?? null
  }));
}

/** Titel als Regex-Literal — auch Titel können Regex-Metazeichen tragen. */
function escapeRegexLiteral(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** YAML-Skalar: Strings mit Sonderlagen in Anfuehrungszeichen, Rest roh. */
function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  return /^[A-Za-z0-9_.@/-]+$/.test(text) ? text : `'${text.replace(/'/g, "''")}'`;
}

/** Endung → MIME fürs Export-Manifest (Bilder haben kein mimetype im Schema). */
function guessAssetMimetype(filename) {
  const extension = path.extname(filename || '').toLowerCase();
  return {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf'
  }[extension] || 'application/octet-stream';
}

/** Einzelner YAML-Skalar aus dem Frontmatter: Anfuehrungszeichen wieder abziehen. */
function unquoteScalar(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * YAML-Frontmatter eines Markdown-Texts parsen (v1.13.0). Absichtlich minimal:
 * `key: value` und `key: [a, b]` decken genau ab, was buildMarkdownExport
 * schreibt — kein voller YAML-Parser. Ohne Frontmatter ist das Ergebnis
 * { meta: {}, body: text }, also ein No-Op fuer den Trilium-Ordner-Import.
 * @param {string} text
 * @returns {{ meta: Object, body: string }}
 */
function parseMarkdownFrontmatter(text) {
  if (typeof text !== 'string') return { meta: {}, body: '' };
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!entry) continue;
    const key = entry[1].toLowerCase();
    const raw = entry[2].trim();
    if (raw === '') {
      meta[key] = null;
      continue;
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      meta[key] = raw.slice(1, -1)
        .split(',')
        .map((part) => unquoteScalar(part.trim()))
        .filter(Boolean);
    } else {
      meta[key] = unquoteScalar(raw);
    }
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Frontmatter-Booleans: Parser liefert Strings, aufrufende koennen echte senden. */
function frontmatterFlag(value) {
  return value === true || value === 'true';
}

/** ISO-Zeitpunkt oder null — kaputte Werte sind null, kein Fehler (robuster Import). */
function frontmatterDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * created/updated aus Fremd-Frontmatter auf jetzt clampen (v1.15.0). Ein
 * `updated: 2999-…` ist immer Muell — aber ein giftiges: Der Android-Sync
 * speichert max(updatedAt) als Cursor (SyncManager setSyncSince) und die
 * Web-Meta-Sonde als Signatur-Bestandteil. Eine einzige Zukunfts-Notiz
 * bedeutet, dass jede spaetere echte Aenderung "in der Vergangenheit" liegt
 * und fuer immer unsichtbar bleibt. remindAt wird NICHT geclampt — Erinnerun-
 * gen in der Zukunft sind der Normalfall.
 */
function clampImportedTimestamp(value, now = new Date()) {
  if (!value) return value;
  return value.getTime() > now.getTime() ? new Date(now.getTime()) : value;
}

/**
 * Markdown-Export des Baums (v1.10.0) als ZIP: Jede Notiz wird eine .md-Datei,
 * jede Notiz mit Kindern ein Verzeichnis mit _index.md plus den Kindern. Das
 * Ergebnis ist ein Round-trip-Partner zum Trilium-/Markdown-Ordner-Import und
 * zugleich ein lesbares Volldaten-Backup.
 * Seit v1.13.0 verlustfrei: YAML-Frontmatter traegt ALLE Metadaten (tags,
 * pinned, archived, isCode, color, remindAt, created/updated), und Bild- und
 * Datei-Anhaenge reisen als assets/ mit — der Markdown-Koerper referenziert
 * sie relativ. Der Import (POST /api/notes/import/markdown-zip) setzt beides
 * zurueck, inklusive frischer Thumbnails. Archivierte Notizen kommen mit,
 * geloeschte nicht.
 * @param {string} userId
 * @returns {Promise<Buffer>} ZIP-Archiv
 */
async function buildMarkdownExport(userId) {
  const notes = await Note.find({ userId, deletedAt: null })
    .select('parentId title content isTodoList todoItems tags isCode order isArchived isPinned createdAt updatedAt color remindAt images.filename files.filename files.originalName files.mimetype')
    .sort({ order: -1, updatedAt: -1 })
    .lean();

  const byId = new Map(notes.map((note) => [String(note._id), note]));
  const childrenOf = new Map();
  for (const note of notes) {
    const key = note.parentId ? String(note.parentId) : null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(note);
  }

  // Dateinamen sanitizen und pro Verzeichnis eindeutig halten — zwei Notizen
  // mit demselben Titel (oder ohne: „Ohne Titel") duerfen sich nicht ueberschreiben.
  const sanitize = (name) => name
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80) || 'Ohne-Titel';

  // Anhaenge mitnehmen: Originaldatei in assets/, Referenz im Koerper
  // relativ umschreiben. Fehlt eine Datei auf der Platte (vom Janitor
  // aufgeraeumt, kaputtes Volume), bleibt die URL wie sie ist — der Text
  // luegt nie ueber eine mitgebrachte Datei. Das Manifest bewahrt Metadaten,
  // die im ZIP-Dateinamen keinen Platz haben (originalName, mimetype).
  const manifest = {};
  const collectedAssets = new Map();
  const rewriteRules = [];
  const collectAsset = async (kind, filename, originalName, mimetype) => {
    if (!filename || collectedAssets.has(filename)) return;
    const source = path.join(kind === 'images' ? imagesDir() : filesDir(), filename);
    let bytes = null;
    try {
      // fs.promises statt readFileSync (v1.16.0): Der Export laeuft hinter dem
      // Route-Gate, aber sync-Reads blockieren trotzdem den Event-Loop — je
      // Anhang friert die ganze Instanz (inkl. mongod-Nachbarn im Host) ein.
      bytes = await fs.promises.readFile(source);
    } catch (_error) {
      return; // Datei weg: Referenz bleibt auf die alte URL zeigen
    }
    collectedAssets.set(filename, true);
    const zipPath = `assets/${kind}/${filename}`;
    manifest[zipPath] = kind === 'files'
      ? { kind, originalName: originalName || filename, mimetype: mimetype || 'application/octet-stream' }
      : { kind, mimetype: mimetype || guessAssetMimetype(filename) };
    rewriteRules.push([`/uploads/${kind}/${filename}`, zipPath, { kind, filename, bytes }]);
  };
  for (const note of notes) {
    for (const image of note.images || []) await collectAsset('images', image.filename, image.filename, 'image/jpeg');
    for (const file of note.files || []) await collectAsset('files', file.filename, file.originalName, file.mimetype);
  }

  const frontmatter = (note) => {
    const lines = ['---'];
    lines.push(`title: ${yamlScalar(note.title || 'Ohne Titel')}`);
    if (note.tags && note.tags.length > 0) {
      lines.push(`tags: [${note.tags.map((tag) => yamlScalar(tag)).join(', ')}]`);
    }
    if (note.isPinned) lines.push('pinned: true');
    if (note.isArchived) lines.push('archived: true');
    if (note.isCode) lines.push('isCode: true');
    if (note.isTodoList) lines.push('isTodoList: true');
    if (note.color && note.color !== '#ffffff') lines.push(`color: ${yamlScalar(note.color)}`);
    if (note.remindAt) lines.push(`remindAt: ${yamlScalar(new Date(note.remindAt).toISOString())}`);
    if (note.createdAt) lines.push(`created: ${yamlScalar(new Date(note.createdAt).toISOString())}`);
    if (note.updatedAt) lines.push(`updated: ${yamlScalar(new Date(note.updatedAt).toISOString())}`);
    lines.push('---', '');
    return lines.join('\n');
  };

  const renderMarkdown = (note) => {
    let body;
    if (note.isTodoList) {
      body = (note.todoItems || [])
        .map((item) => `- [${item.completed ? 'x' : ' '}] ${item.text}`)
        .join('\n');
    } else {
      body = note.content || '';
      for (const [url, zipPath] of rewriteRules) {
        body = body.split(url).join(zipPath);
      }
    }
    return `${frontmatter(note)}${body}`.replace(/\s+$/, '') + '\n';
  };

  const zip = new ZipWriter();
  const usedNames = new Set();
  const uniqueName = (parentPath, name) => {
    let candidate = `${parentPath ? parentPath + '/' : ''}${sanitize(name)}`;
    let counter = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${parentPath ? parentPath + '/' : ''}${sanitize(name)}-${counter++}`;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  // Defensive (v1.10.1): written-Set + Tiefen-Cap. Der PUT-Zyklusschutz haelt
  // den Bestand normalerweise zyklusfrei, aber direkt in der DB manipulierte
  // oder vor dem Schutz angelegte Daten duerfen den Export nicht in eine
  // Endlos-Rekursion schicken.
  const written = new Set();
  const writeNode = (note, parentPath, depth = 0) => {
    const id = String(note._id);
    if (written.has(id) || depth > 50) return;
    written.add(id);
    const children = childrenOf.get(String(note._id)) || [];
    if (children.length === 0) {
      const path = uniqueName(parentPath, note.title || 'Ohne-Titel');
      zip.add(`${path}.md`, renderMarkdown(note));
      return;
    }
    const dirPath = uniqueName(parentPath, note.title || 'Ordner');
    zip.add(`${dirPath}/_index.md`, renderMarkdown(note));
    for (const child of children) {
      writeNode(child, dirPath, depth + 1);
    }
  };

  for (const root of childrenOf.get(null) || []) {
    writeNode(root, '', 0);
  }

  // Unerreichbare Notizen (Eltern geloescht, Zyklus): oben ausgeben, statt sie
  // still im Backup verschwinden zu lassen.
  for (const note of notes) {
    if (!written.has(String(note._id))) writeNode(note, '', 0);
  }

  // Anhaenge ans Archiv: Originalbilder und PDFs, KEINE Thumbnails (die
  // regeneriert der Import mit scharp) — das haelt den Export klein.
  for (const [, zipPath, asset] of rewriteRules) {
    zip.add(zipPath, asset.bytes);
  }
  if (Object.keys(manifest).length > 0) {
    zip.add('assets/manifest.json', JSON.stringify(manifest, null, 2));
  }

  // Komplett leere Bibliothek: trotzdem ein gueltiges (leeres) Archiv liefern,
  // kein 500 und kein „null"-Body.
  return zip.finish();
}

// Bulk-Import (v1.10.1): Der Web-Client schickte bisher eine Create-Request
// pro Datei UND pro Ordnersegment — ein Trilium-Export mit 300 Notizen war
// eine 300+-Request-Sequenz, bei der ein Netzfehler mitten drin einen
// halben Import ohne Aufraeumen hinterliess. Der Bulk-Endpoint nimmt den
// ganzen Chunk in einem Zug an: validiert alles VOR dem ersten Schreiben
// (kaputter Chunk legt nichts an) und legt Ordner+Notizen mit insertMany an.
const IMPORT_MAX_ITEMS = 500;
const IMPORT_MAX_PATH = 400;
const IMPORT_MAX_DEPTH = 20;

async function importMarkdownNotes(userId, rawItems, { demoLimit = null, assetMap = null } = {}) {
  // 1) Normalisieren und validieren — ein fehlerhafter Chunk bricht komplett
  //    ab, statt halb angelegt zu enden.
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw clientError('Import benötigt eine nicht leere items-Liste');
  }
  if (rawItems.length > IMPORT_MAX_ITEMS) {
    throw clientError(`Pro Aufruf sind maximal ${IMPORT_MAX_ITEMS} Einträge erlaubt`);
  }

  const items = rawItems.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw clientError(`items[${index}] ist kein Objekt`);
    const path = typeof raw.path === 'string' ? raw.path.replace(/^\/+|\/+$/g, '') : '';
    if (path.length > IMPORT_MAX_PATH) throw clientError(`items[${index}].path ist zu lang`);
    const segments = path === '' ? [] : path.split('/');
    if (segments.length > IMPORT_MAX_DEPTH) {
      throw clientError(`items[${index}].path ist tiefer als ${IMPORT_MAX_DEPTH} Ebenen`);
    }
    for (const segment of segments) {
      if (segment.trim().length === 0 || segment.length > 200) {
        throw clientError(`items[${index}].path enthält ein leeres oder zu langes Segment`);
      }
    }
    if (raw.content !== undefined && typeof raw.content !== 'string') {
      throw clientError(`items[${index}].content muss ein String sein`);
    }
    if (raw.content !== undefined && raw.content.length > 10000) {
      throw clientError(`items[${index}].content ist länger als 10.000 Zeichen`);
    }

    // Frontmatter (v1.13.0): Der koerpertragene Metadaten-Block aus dem
    // Round-trip-Export. Der alte Trilium-Ordner-Import sendet title/tags
    // direkt — die treffen hier auf leeres Meta und verhalten sich wie zuvor.
    const { meta, body } = parseMarkdownFrontmatter(
      (typeof raw.content === 'string' ? raw.content : '').slice(0, 10000)
    );
    // Meta-Keys sind lowercased (Parser) — die Zugriffe hier nutzen genau
    // dieselbe Schreibweise, bleibt case-insensitiv fuer Fremd-Frontmatter.
    const rawTags = Array.isArray(raw.tags)
      ? raw.tags.map(tag => (typeof tag === 'string' ? tag.trim().slice(0, 50) : '')).filter(Boolean)
      : [];
    const metaTags = Array.isArray(meta.tags)
      ? meta.tags.map(tag => (typeof tag === 'string' ? tag.trim().slice(0, 50) : '')).filter(Boolean)
      : [];
    const tags = [...new Set([...rawTags, ...metaTags].map((tag) => tag.toLowerCase()))].slice(0, 50);

    // Asset-Rewrite: ZIP-Pfade aus dem Export werden wieder Server-URLs; nur
    // referenzierte Anhaenge haengen an der Notiz (Inlined-Bilder + verlinkte
    // Dateien). Frische, zufaellige Speichernamen — ein Import kollidiert nie
    // mit Bestandsdateien und kann nichts ueberschreiben.
    let content = body;
    const attachedImages = new Map();
    const attachedFiles = new Map();
    if (assetMap) {
      for (const [zipPath, asset] of assetMap) {
        if (!content.includes(zipPath)) continue;
        content = content.split(zipPath).join(asset.url);
        (asset.kind === 'images' ? attachedImages : attachedFiles).set(asset.url, asset);
      }
    }
    if (attachedImages.size > MAX_IMAGES_PER_NOTE) {
      throw clientError(`items[${index}] referenziert mehr als ${MAX_IMAGES_PER_NOTE} Bilder`);
    }
    if (attachedFiles.size > MAX_FILES_PER_NOTE) {
      throw clientError(`items[${index}] referenziert mehr als ${MAX_FILES_PER_NOTE} Dateianhänge`);
    }
    // Der umgeschriebene Inhalt kann durch die laengeren Server-URLs wachsen —
    // die 10-KB-Grenze gilt weiterhin (Kuerzung wie beim Markdown-Body).
    content = content.slice(0, 10000);

    const explicitTitle = typeof raw.title === 'string' && raw.title.trim();
    const frontTitle = typeof meta.title === 'string' && meta.title.trim();
    // Titel-Rangfolge: Frontmatter vor explizitem Titel. Der Dateiname im ZIP
    // ist nur der sanitizte Fallback („Rezepte- Desserts!"), das Frontmatter
    // traegt den exakten Originaltitel („Rezepte: Desserts!"). Ohne beides:
    // 'Notiz' (bisheriges Verhalten des Ordner-Imports).
    const resolvedTitle = frontTitle || explicitTitle;

    // Todo-Round-trip: Der Export schreibt Todo-Listen als Checkbox-Markdown
    // plus isTodoList-Flag. Ein Body, der NUR aus Checkbox-Zeilen besteht,
    // wird wieder zur Todo-Liste; alles andere bleibt Markdown (fremde
    // Exporte, die zufaellig Checkboxen enthalten, verlieren nichts).
    let isTodoList = frontmatterFlag(meta.istodolist);
    let todoItems = [];
    if (isTodoList) {
      const parsed = [];
      let allCheckbox = content.trim() !== '';
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        const checkbox = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(trimmed);
        if (!checkbox) { allCheckbox = false; break; }
        parsed.push({ text: checkbox[2].slice(0, 500), completed: checkbox[1].toLowerCase() === 'x', order: parsed.length });
      }
      if (allCheckbox && parsed.length > 0 && parsed.length <= 200) {
        todoItems = parsed;
        content = '';
      } else {
        isTodoList = false;
      }
    }

    const color = NOTE_COLORS.has(String(meta.color)) ? String(meta.color) : '#ffffff';
    // Zukunfts-Daten clampen (v1.15.0, siehe clampImportedTimestamp) und
    // Monotonie herstellen: created darf nie nach updated liegen — Sortierung
    // und Sync-Cursor verlassen sich auf beide.
    const importNow = new Date();
    let importedCreatedAt = clampImportedTimestamp(frontmatterDate(meta.created), importNow);
    let importedUpdatedAt = clampImportedTimestamp(frontmatterDate(meta.updated), importNow);
    if (importedCreatedAt && importedUpdatedAt && importedCreatedAt.getTime() > importedUpdatedAt.getTime()) {
      importedCreatedAt = importedUpdatedAt;
    }
    return {
      path,
      segments,
      isFolderIndex: raw.isFolderIndex === true,
      title: (resolvedTitle ? String(resolvedTitle).trim().slice(0, 200) : 'Notiz'),
      content,
      tags,
      isTodoList,
      todoItems,
      isPinned: frontmatterFlag(meta.pinned) === true,
      isArchived: frontmatterFlag(meta.archived) === true,
      isCode: frontmatterFlag(meta.iscode) === true,
      color,
      remindAt: frontmatterDate(meta.remindat),
      createdAt: importedCreatedAt,
      updatedAt: importedUpdatedAt,
      attachedImages,
      attachedFiles
    };
  });

  // _index.md (v1.13.0): Der Export schreibt die Ordner-Notiz selbst als
  // <ordner>/_index.md. Beim Import verschmilzt sie wieder MIT dem Ordner-
  // knoten — sonst entstuende ein leeres Ordner-Duplikat plus ein gleichnamiges
  // Kind. Vorhandene Ordner (Wiederverwendung nach Titel) werden NICHT
  // ueberschrieben; ihr Index-Inhalt faellt damit still weg (bewusst: kein
  // Import ueberschreibt Bestandsdaten).
  const indexItemByPath = new Map();
  const noteItems = [];
  for (const item of items) {
    if (item.isFolderIndex && item.path !== '' && !indexItemByPath.has(item.path)) {
      indexItemByPath.set(item.path, item);
      continue;
    }
    noteItems.push(item);
  }

  // 2) Alle Ordnerpfade sammeln (eindeutig, Wurzel ausgenommen).
  const folderPathSet = new Set();
  for (const item of items) {
    for (let depth = 1; depth <= item.segments.length; depth += 1) {
      folderPathSet.add(item.segments.slice(0, depth).join('/'));
    }
  }
  // Eltern zuerst: kuerzere Pfade haben weniger Segmente.
  const orderedFolderPaths = [...folderPathSet].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
  );

  // 3) Bestand einmal lesen: Titel+parentId fuer die Ordner-Wiederverwendung.
  //    Ein erneuter Import desselben Ordners landet so IM selben Knoten statt
  //    in einem Duplikat. (Jede Notiz mit Kindern ist ein Ordner — auch eine
  //    bisherige Blattnotiz mit passendem Titel wird zum Elternknoten.)
  const existingNotes = await Note.find({ userId, deletedAt: null })
    .select('parentId title')
    .lean();
  const idByParentTitle = new Map();
  for (const note of existingNotes) {
    idByParentTitle.set(`${note.parentId ? String(note.parentId) : ''}|${note.title}`, String(note._id));
  }

  // 4) Ordner-IDs aufloesen: vorhandene wiederverwenden, fehlende merken.
  const folderIdByPath = new Map();
  const newFolders = [];
  for (const folderPath of orderedFolderPaths) {
    const segments = folderPath.split('/');
    const title = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parentId = parentPath === '' ? null : (folderIdByPath.get(parentPath) ?? null);
    // Metadaten des _index.md (falls vorhanden) — die Ordner-Notiz IST die
    // _index-Notiz: exakter Originaltitel, Inhalt, Tags, Pin, Farbe,
    // Erinnerung, Anhaenge.
    const indexItem = indexItemByPath.get(folderPath) || null;
    const exactTitle = indexItem?.title;
    // Wiederverwendung: erst unter dem exakten Originaltitel suchen (Round-
    // trip — der Bestand traegt den Originaltitel, nicht das Pfadsegment),
    // dann unter dem Segment (alter Ordner-Import / Fremd-ZIP ohne Frontmatter).
    const parentKey = parentId ? String(parentId) : '';
    const existingId = (exactTitle ? idByParentTitle.get(`${parentKey}|${exactTitle}`) : null)
      ?? idByParentTitle.get(`${parentKey}|${title}`);
    if (existingId) {
      folderIdByPath.set(folderPath, existingId);
      continue;
    }
    const folderId = new mongoose.Types.ObjectId();
    folderIdByPath.set(folderPath, String(folderId));
    idByParentTitle.set(`${parentKey}|${title}`, String(folderId));
    if (exactTitle) idByParentTitle.set(`${parentKey}|${exactTitle}`, String(folderId));
    newFolders.push({
      _id: folderId,
      title: exactTitle || title,
      content: indexItem ? indexItem.content : '',
      tags: indexItem ? indexItem.tags : [],
      isTodoList: indexItem?.isTodoList === true,
      todoItems: indexItem?.todoItems || [],
      isPinned: indexItem?.isPinned === true,
      isArchived: indexItem?.isArchived === true,
      isCode: indexItem?.isCode === true,
      color: indexItem?.color || '#ffffff',
      remindAt: indexItem?.remindAt ?? null,
      images: indexItem ? attachmentMetadata(indexItem).images : [],
      files: indexItem ? attachmentMetadata(indexItem).files : [],
      ...(indexItem?.createdAt ? { createdAt: indexItem.createdAt, updatedAt: indexItem.updatedAt ?? indexItem.createdAt } : {}),
      parentId, userId, order: 0
    });
  }

  // 5) Demo-Budget: Einzel-Creates prueft enforceDemoNoteLimit (Bestand < Limit),
  //    hier muss die Chunk-Groesse mitrechnen, sonst sprengt ein Rutsch das Limit.
  //    Verschmolzene _index-Eintraege zaehlen nicht doppelt — sie werden zum
  //    Ordner, nicht zur zusaetzlichen Notiz.
  if (demoLimit != null) {
    const noteCount = await Note.countDocuments({ userId, deletedAt: null });
    if (noteCount + noteItems.length + newFolders.length > demoLimit) {
      const error = new Error(`Die oeffentliche Demo ist auf ${demoLimit} Notizen begrenzt.`);
      error.statusCode = 429;
      error.code = 'DEMO_NOTE_LIMIT';
      throw error;
    }
  }

  // 6) Anlegen: Ordner zuerst (Eltern vor Kindern, insertMany haelt die
  //    Reihenfolge), dann die Notizen mit aufsteigenden order-Werten ab der
  //    aktuellen Spitze — importierte Notizen stehen oben in Datei-Reihenfolge.
  if (newFolders.length > 0) {
    await Note.insertMany(newFolders);
  }
  const baseOrder = await nextTopOrder(userId, false);
  const newNotes = noteItems.map((item, index) => ({
    title: item.title,
    content: item.content,
    tags: item.tags,
    isTodoList: item.isTodoList === true,
    todoItems: item.todoItems || [],
    isPinned: item.isPinned === true,
    isArchived: item.isArchived === true,
    isCode: item.isCode === true,
    color: item.color || '#ffffff',
    remindAt: item.remindAt ?? null,
    images: attachmentMetadata(item).images,
    files: attachmentMetadata(item).files,
    ...(item.createdAt ? { createdAt: item.createdAt, updatedAt: item.updatedAt ?? item.createdAt } : {}),
    parentId: item.segments.length === 0 ? null : (folderIdByPath.get(item.segments.join('/')) ?? null),
    userId,
    order: baseOrder + index
  }));
  await Note.insertMany(newNotes);

  return {
    created: newNotes.length,
    foldersCreated: newFolders.length,
    folderIds: [...folderIdByPath.values()]
  };
}

/** attachments eines normalisierten Items als images[]/files[]-Metadaten. */
function attachmentMetadata(item) {
  const uploadedAt = new Date();
  return {
    images: [...item.attachedImages.values()].map((asset) => ({
      url: asset.url,
      filename: asset.filename,
      thumbnailUrl: asset.thumbnailUrl || '',
      thumbnailFilename: asset.thumbnailFilename || '',
      size: asset.size ?? 0,
      uploadedAt
    })),
    files: [...item.attachedFiles.values()].map((asset) => ({
      url: asset.url,
      filename: asset.filename,
      originalName: asset.originalName || asset.filename,
      mimetype: asset.mimetype || 'application/octet-stream',
      size: asset.size ?? 0,
      uploadedAt
    }))
  };
}

/**
 * Markdown-ZIP-Import (v1.13.0) — der Empfangsteil des Round-trips zu
 * buildMarkdownExport: liest das Archiv serverseitig (der Client hat keinen
 * ZIP-Unpacker), schreibt die Anhaenge unter frischen Zufallsnamen auf die
 * Platte (Thumbnails inklusive) und fuehrt die .md-Eintraege dem normalen
 * importMarkdownNotes zu. Fremd-ZIPs (Obsidian-Ordner, Trilium-Exporte ohne
 * Frontmatter) laufen denselben Weg: Fehlendes Frontmatter ist optional.
 * Zip-Slip ist strukturell ausgeschlossen — es wird NIEMALS unter einem Namen
 * aus dem Archiv geschrieben, sondern immer unter frischen Zufallsnamen.
 * @param {string} userId
 * @param {Buffer} zipBuffer - Rohdaten des Archivs
 * @param {Object} [options]
 * @returns {Promise<{created: number, foldersCreated: number, folderIds: string[]}>}
 */
async function importMarkdownZip(userId, zipBuffer, { demoLimit = null } = {}) {
  let entries;
  try {
    entries = readZipEntries(zipBuffer);
  } catch (error) {
    throw clientError(`Das Archiv liest sich nicht als ZIP: ${error.message}`);
  }

  // Manifest (vom eigenen Export): Metadaten der Anhaenge, die im ZIP-Datei-
  // namen keinen Platz haben. Fehlt es (Fremd-ZIP), wird auf Namen/Endung
  // zurueckgefallen.
  let manifest = {};
  const manifestRaw = entries.get('assets/manifest.json');
  if (manifestRaw) {
    try {
      const parsed = JSON.parse(manifestRaw.toString('utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) manifest = parsed;
    } catch (_error) {
      manifest = {}; // kaputtes Manifest: Anhaenge trotzdem importieren
    }
  }

  // 1) Anhaenge unter frischen Namen wegschreiben (Bilder mit Thumbnail).
  //    Nur Eintraege unter assets/ sind Kandidaten; alles andere im Archiv
  //    ist hoechstens Markdown (Schritt 2). Zielverzeichnisse sicherstellen —
  //    der Import ist auch gegen einen frisch geleerten Volume lauffaehig.
  //    Quota zuerst (v1.16.0): Der Import ist alles-oder-nichts — die
  //    geplanten Anhang-Bytes werden geprüft, BEVOR die erste Datei entsteht.
  let plannedAssetBytes = 0;
  for (const [name, bytes] of entries) {
    if (name.startsWith('assets/images/') || name.startsWith('assets/files/')) plannedAssetBytes += bytes.length;
  }
  await assertStorageQuota(userId, plannedAssetBytes);
  fs.mkdirSync(imagesDir(), { recursive: true });
  fs.mkdirSync(filesDir(), { recursive: true });
  const assetMap = new Map();
  // Bereits geschriebene Dateien sammeln: Lehnt die Validierung einen Anhang
  // ab, darf kein orphan file zurueckbleiben — der Import ist alles-oder-nichts.
  const written = [];
  try {
    for (const [name, bytes] of entries) {
      const kind = name.startsWith('assets/images/') ? 'images' : name.startsWith('assets/files/') ? 'files' : null;
      if (!kind) continue;
      const meta = (manifest[name] && typeof manifest[name] === 'object') ? manifest[name] : {};
      const extension = path.extname(name).toLowerCase() || '.bin';
      if (kind === 'images') {
        // Geschaerfter als vorher (v1.14.0): Bild-Eintraege aus einem Fremd-ZIP
        // bekamen ihre Endung vom Angreifer gewaehlt und wurden ohne Magic-Byte-
        // Pruefung nach uploads/images geschrieben — secureFileServe stellt per
        // sendFile nach Endung aus, ein .html/.svg-Eintrag war Stored XSS.
        // Der Multipart-Bildupload validiert beides bereits; der ZIP-Import
        // zieht jetzt nach: Endungs-Whitelist + Magic Bytes, sonst 400er.
        if (!ZIP_IMAGE_EXTENSIONS.has(extension)) {
          throw clientError(`Anhang ${name}: keine erlaubte Bild-Endung (${[...ZIP_IMAGE_EXTENSIONS].join(', ')})`);
        }
        const filename = `${crypto.randomBytes(24).toString('hex')}${extension}`;
        const filepath = path.join(imagesDir(), filename);
        fs.writeFileSync(filepath, bytes);
        written.push(filepath);
        if (!(await validateImageFile(filepath))) {
          throw clientError(`Anhang ${name}: Inhalt entspricht keinem bekannten Bildformat (Magic-Bytes-Prüfung)`);
        }
        // Dritte Pruefung des Multipart-Pfads (Review v1.14.0): Endung + Magic
        // Bytes reichen nicht — eine 20000x20000-PNG ist komprimiert wenige MB
        // gross, dekodiert aber ~1,6 GB im Client. Der Multipart-Upload lehnt
        // sie ab (>40 MP), der ZIP-Import muss dasselbe tun.
        await validateImageDimensions([filepath]);
        let thumbnailFilename = '';
        try {
          thumbnailFilename = await generateThumbnail(filename, filepath);
          if (thumbnailFilename) written.push(path.join(imagesDir(), thumbnailFilename));
        } catch (_error) {
          thumbnailFilename = ''; // kein Thumbnail: Galerie faellt aufs Original zurueck
        }
        assetMap.set(name, {
          kind, filename, url: `/uploads/images/${filename}`,
          thumbnailFilename, thumbnailUrl: thumbnailFilename ? `/uploads/images/${thumbnailFilename}` : '',
          size: bytes.length
        });
      } else {
        const filename = `${crypto.randomBytes(24).toString('hex')}${extension}`;
        fs.writeFileSync(path.join(filesDir(), filename), bytes);
        written.push(path.join(filesDir(), filename));
        assetMap.set(name, {
          kind, filename, url: `/uploads/files/${filename}`,
          originalName: typeof meta.originalName === 'string' && meta.originalName.trim()
            ? meta.originalName.slice(0, 255)
            : path.basename(name),
          mimetype: typeof meta.mimetype === 'string' && meta.mimetype ? meta.mimetype : guessAssetMimetype(name),
          size: bytes.length
        });
      }
    }
  } catch (error) {
    for (const filepath of written) {
      try { fs.rmSync(filepath, { force: true }); } catch (_cleanupError) { /* best effort */ }
    }
    throw error;
  }

  // 2) .md-Eintraege zu Items formen. Pfad = Verzeichnis im Archiv (die
  //    Baumstruktur bleibt erhalten), Titel aus Frontmatter oder Dateiname.
  //    _index.md markiert die Ordner-Notiz selbst (siehe importMarkdownNotes).
  const items = [];
  for (const [name, bytes] of entries) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    if (name.startsWith('assets/') || name.includes('__MACOSX/')) continue;
    if (path.posix.basename(name).startsWith('.')) continue;
    const directory = path.posix.dirname(name);
    const folderPath = directory === '.' || directory === '/' ? '' : directory;
    const base = path.posix.basename(name, '.md');
    const isFolderIndex = base === '_index';
    const fallbackTitle = isFolderIndex
      ? (folderPath ? path.posix.basename(folderPath) : 'Notiz')
      : base;
    items.push({
      path: folderPath,
      title: fallbackTitle,
      content: bytes.toString('utf8'),
      isFolderIndex
    });
  }
  if (items.length === 0) {
    throw clientError('Das Archiv enthält keine Markdown-Dateien');
  }

  return importMarkdownNotes(userId, items, { demoLimit, assetMap });
}

// Tag-Verwaltung (v1.11.0): Umbenennen/Zusammenfuehren/Loeschen ueber alle
// sichtbaren Notizen — der Web-Client hatte gar keine Tag-Pflege, und die
// Android-App schreibt jede Notiz einzeln. Ein updateMany pro Operation macht
// daraus einen Rutsch; der Scope entspricht der Sidebar-Tag-Liste: eigene +
// geteilte, nicht geloeschte Notizen (aktiv UND archiviert, wie die App zaehlt).
const TAG_OPERATION_ACTIONS = new Set(['rename', 'merge', 'delete']);

async function applyTagOperation({ userId, action, from, to }) {
  if (!TAG_OPERATION_ACTIONS.has(action)) {
    throw clientError('action muss rename, merge oder delete sein');
  }
  if (!Array.isArray(from) || from.length === 0 || from.length > 50) {
    throw clientError('from muss ein Array mit 1 bis 50 Tags sein');
  }
  const fromTags = [...new Set(from
    .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
    .filter(Boolean)
  )];
  if (fromTags.length === 0) throw clientError('from enthält keine gültigen Tags');
  for (const tag of fromTags) {
    if (tag.length > 50 || !TAG_PATTERN.test(tag)) throw clientError(`Ungültiger Tag: ${tag}`);
  }

  let target = null;
  if (action !== 'delete') {
    if (typeof to !== 'string') throw clientError('to muss für rename/merge ein Tag sein');
    target = to.trim().toLowerCase();
    if (!target || target.length > 50 || !TAG_PATTERN.test(target)) {
      throw clientError('Ungültiger Ziel-Tag');
    }
  }

  // Sichtbarkeit wie Sidebar/Tag-Liste: eigene + geteilte, nicht gelöschte
  // (archiviert eingeschlossen — so zählt auch die Android-Übersicht).
  const baseQuery = {
    deletedAt: null,
    $or: [{ userId }, { sharedWith: userId }]
  };

  // Umbenennen auf einen Tag, der (als einzige Quelle) bereits das Ziel ist:
  // reiner No-Op, kein updateMany.
  const sources = target === null ? fromTags : fromTags.filter(tag => tag !== target);
  if (sources.length === 0) return { action, modified: 0 };

  const editedAt = new Date();
  // Case-Insensitivitaet (v1.15.0): Der Bestand kann gemischte Schreibweisen
  // tragen ("Projekt" neben "projekt" — der Import lowercased seit jeher, der
  // Web-/Android-Editor nicht). $in matcht case-sensitiv, deshalb trifft der
  // Filter Regex-Varianten jedes Quell-Tags; TAG_PATTERN schliesst Regex-
  // Metazeichen aus, ^…$/$i ist daher sicher. Dasselbe gilt im $filter der
  // Pipeline: $toLower vergleicht gegen die lowercased Quellen, damit auch der
  // Bestands-Eintrag "Projekt" beim Rename auf "projekt" erfasst und entfernt
  // wird (vorher blieb er unberuehrt stehen — das bekannte v1.14.0-Loch).
  const sourceMatchers = sources.map(tag => new RegExp(`^${tag}$`, 'i'));
  if (action === 'delete') {
    const result = await Note.updateMany(
      { ...baseQuery, tags: { $in: sourceMatchers } },
      [{ $set: {
        tags: { $filter: { input: '$tags', cond: { $not: [{ $in: [{ $toLower: '$$this' }, sources] }] } } },
        updatedAt: editedAt,
        lastEditedBy: userId
      } }]
    );
    return { action, modified: result.modifiedCount };
  }

  // rename/merge: Quell-Tags herausfiltern, Ziel per setUnion dazugeben —
  // eine Notiz mit zwei Quell-Tags endet mit genau einem Ziel-Tag.
  const result = await Note.updateMany(
    { ...baseQuery, tags: { $in: sourceMatchers } },
    [{ $set: {
      tags: { $setUnion: [
        { $filter: { input: '$tags', cond: { $not: [{ $in: [{ $toLower: '$$this' }, sources] }] } } },
        [target]
      ] },
      updatedAt: editedAt,
      lastEditedBy: userId
    } }]
  );
  return { action, modified: result.modifiedCount };
}

/**
 * Toggle pin status of a note
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Updated note
 */
async function togglePinNote(noteId, userId) {
  // Atomarer Toggle per Update-Pipeline statt Read-Modify-Write: Zwei schnelle
  // Klicks oder zwei Tabs konnten vorher einen Toggle still verlieren, weil
  // beide denselben Stand lasen und der letzte Schreibende gewann.
  // Pipelines werden von Mongoose nicht gecastet — lastEditedBy deshalb
  // explizit als ObjectId, nicht als String aus req.user._id.toString().
  const lastEditedBy = mongoose.isValidObjectId(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const note = await Note.findOneAndUpdate(
    noteEditQuery(noteId, userId),
    [{ $set: { isPinned: { $not: ['$isPinned'] }, lastEditedBy } }],
    { new: true, projection: { revisions: 0 } }
  );

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Toggle archive status of a note
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Updated note
 */
async function toggleArchiveNote(noteId, userId) {
  // Wie togglePinNote: atomarer Pipeline-Toggle, kein Read-Modify-Write.
  // Archivieren bleibt besitzer-exklusiv (kein noteEditQuery).
  const lastEditedBy = mongoose.isValidObjectId(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId,
      deletedAt: null
    },
    [{ $set: { isArchived: { $not: ['$isArchived'] }, lastEditedBy } }],
    { new: true, projection: { revisions: 0 } }
  );

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Share a note with another user
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {string} targetUserId - User ID to share with
 * @returns {Promise<Object>} Updated note
 */
async function shareNote(noteId, userId, targetUserId) {
  // SECURITY/DATA INTEGRITY: Verify target user exists before sharing
  // This prevents creating dangling references to deleted users
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    const error = new Error('Benutzer nicht gefunden');
    error.statusCode = 404;
    throw error;
  }

  // Sharing puts a note into somebody else's account, so it requires an
  // accepted friendship. Without this check any authenticated user could push
  // notes to arbitrary accounts (user ids are discoverable through the friend
  // search), and the CollaborateModal only ever lists friends anyway.
  const owner = await User.findById(userId).select('friends');
  const isFriend = Boolean(owner?.friends?.some(friendId => String(friendId) === String(targetUserId)));
  if (!isFriend) {
    const error = new Error('Notizen koennen nur mit Freunden geteilt werden');
    error.statusCode = 403;
    throw error;
  }

  // Use atomic operation to prevent race conditions
  // $addToSet ensures no duplicates even with concurrent requests
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId
    },
    {
      $addToSet: { sharedWith: targetUserId }
    },
    {
      new: true, projection: { revisions: 0 }, // Return updated document
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Unshare a note from a user
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {string} targetUserId - User ID to unshare from
 * @returns {Promise<Object>} Updated note
 */
async function unshareNote(noteId, userId, targetUserId) {
  // Use atomic operation to prevent race conditions
  // $pull removes the user ID from the array
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId
    },
    {
      $pull: { sharedWith: targetUserId }
    },
    {
      new: true, projection: { revisions: 0 }, // Return updated document
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Revoke every share between two users, in both directions.
 *
 * Called when a friendship ends. Collaborators may read AND edit a shared note
 * (content, title, tags, colour, pin, images, transcription), so keeping the
 * `sharedWith` entry would silently leave an ex-friend with write access to
 * somebody else's notes. Deleting a user already does the same cleanup
 * (adminService), unfriending did not.
 *
 * @param {string|ObjectId} firstUserId
 * @param {string|ObjectId} secondUserId
 * @returns {Promise<{revoked: number}>} number of notes that lost a collaborator
 */
async function revokeSharedNotesBetween(firstUserId, secondUserId) {
  const [mine, theirs] = await Promise.all([
    Note.updateMany(
      { userId: firstUserId, sharedWith: secondUserId },
      { $pull: { sharedWith: secondUserId } }
    ),
    Note.updateMany(
      { userId: secondUserId, sharedWith: firstUserId },
      { $pull: { sharedWith: firstUserId } }
    )
  ]);
  return { revoked: (mine?.modifiedCount || 0) + (theirs?.modifiedCount || 0) };
}

/**
 * Add images to a note
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {Array} imageData - Array of image objects {url, filename, uploadedAt}
 * @returns {Promise<Object>} Updated note
 */
async function addImages(noteId, userId, imageData) {
  if (!Array.isArray(imageData) || imageData.length < 1 || imageData.length > 5) {
    throw clientError('Pro Upload sind 1 bis 5 Bilder erlaubt');
  }

  const note = await Note.findOneAndUpdate(
    {
      ...noteEditQuery(noteId, userId),
      $expr: {
        $lte: [
          { $size: { $ifNull: ['$images', []] } },
          MAX_IMAGES_PER_NOTE - imageData.length
        ]
      }
    },
    {
      $push: { images: { $each: imageData } }
    },
    {
      new: true, projection: { revisions: 0 },
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const ownedNoteExists = await Note.exists({ _id: noteId, userId });
    if (ownedNoteExists) {
      throw clientError(`Maximal ${MAX_IMAGES_PER_NOTE} Bilder pro Notiz erlaubt`);
    }
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Remove an image from a note
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {string} filename - Image filename to remove
 * @returns {Promise<Object>} Updated note
 */
async function removeImage(noteId, userId, filename) {
  const note = await Note.findOneAndUpdate(
    {
      ...noteEditQuery(noteId, userId),
      'images.filename': filename
    },
    {
      $pull: { images: { filename: filename } }
    },
    {
      new: true, projection: { revisions: 0 },
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Dateianhänge an eine Notiz haengen (v1.12.0, PDF). Konditionales $push mit
 * $size-Gegenprobe wie bei addImages: Das Limit haelt der atomare Update-
 * Filter ein, kein Read-Modify-Write-Rennen.
 */
async function addFiles(noteId, userId, fileData) {
  if (!Array.isArray(fileData) || fileData.length < 1 || fileData.length > 5) {
    throw clientError('Pro Upload sind 1 bis 5 Dateien erlaubt');
  }

  const note = await Note.findOneAndUpdate(
    {
      ...noteEditQuery(noteId, userId),
      $expr: {
        $lte: [
          { $size: { $ifNull: ['$files', []] } },
          MAX_FILES_PER_NOTE - fileData.length
        ]
      }
    },
    {
      $push: { files: { $each: fileData } }
    },
    {
      new: true, projection: { revisions: 0 },
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const ownedNoteExists = await Note.exists({ _id: noteId, userId });
    if (ownedNoteExists) {
      throw clientError(`Maximal ${MAX_FILES_PER_NOTE} Dateianhänge pro Notiz erlaubt`);
    }
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/** Einzelnen Dateianhang von der Notiz loesen (Datei loescht die Route). */
async function removeFile(noteId, userId, filename) {
  const note = await Note.findOneAndUpdate(
    {
      ...noteEditQuery(noteId, userId),
      'files.filename': filename
    },
    {
      $pull: { files: { filename: filename } }
    },
    {
      new: true, projection: { revisions: 0 },
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

module.exports = {
  getAllNotes,
  getNoteById,
  getEditableNoteById,
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  purgeNote,
  emptyTrash,
  reorderNotes,
  nextTopOrder,
  togglePinNote,
  toggleArchiveNote,
  shareNote,
  unshareNote,
  revokeSharedNotesBetween,
  getNoteTree,
  getNotesMeta,
  getNoteBacklinks,
  getNoteRevisions,
  getNoteRevision,
  restoreNoteRevision,
  buildMarkdownExport,
  importMarkdownNotes,
  importMarkdownZip,
  parseMarkdownFrontmatter,
  applyTagOperation,
  addImages,
  removeImage,
  addFiles,
  removeFile,
  deleteNoteFiles,
  generateThumbnail, // Export for use in routes
  validateImageDimensions,
  deleteNoteImages, // Export for use in adminService
  buildNotesQuery, // Export for testing
  normalizePositiveInteger,
  validateNoteContent,
  validateNoteFields,
};
