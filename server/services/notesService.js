/**
 * Notes Service
 * Business logic for note operations
 * Extracted from routes for better maintainability and testability
 */

const Note = require('../models/Note');
const User = require('../models/User');
const mongoose = require('mongoose');
const { errorMessages } = require('../constants');
const { imagesDir } = require('../config/paths');
const { ZipWriter } = require('../utils/zipWriter');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const NOTE_COLORS = new Set([
  '#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb',
  '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed'
]);
const TAG_PATTERN = /^[a-zA-Z0-9äöüÄÖÜß\-_]+$/;
const MAX_IMAGE_PIXELS = 40000000;
const MAX_IMAGES_PER_NOTE = 25;
const NOTE_CONFLICT_MESSAGE = 'Die Notiz wurde inzwischen geändert';
// Baum (v1.10.0): Zweites Netz unter dem Zyklus-Schutz — siehe assertValidParent.
const MAX_TREE_DEPTH = 50;
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
  // same serialized form as a regular PUT response.
  error.currentNote = note;
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
  for (const field of ['isPinned', 'isTodoList']) {
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
async function getAllNotes({ userId, search, tag, page = 1, limit = 50, archived = 'false', deleted = 'false', folderId } = {}) {
  const safePage = normalizePositiveInteger(page, 1, Number.MAX_SAFE_INTEGER);
  const safeLimit = normalizePositiveInteger(limit, 50, 100);
  const isArchived = archived === true || archived === 'true';
  const isDeleted = deleted === true || deleted === 'true';

  // Papierkorb: nur eigene Notizen, unabhängig vom Archiv-Status, zuletzt
  // gelöschte zuerst. Suche/Tag-Filter bleiben verfügbar.
  if (isDeleted) {
    const trashQuery = {
      userId,
      deletedAt: { $ne: null },
      ...(typeof search === 'string' && search.trim() !== '' ? { $text: { $search: search.trim() } } : {})
    };
    const skip = (safePage - 1) * safeLimit;
    const [trashTotal, trashNotes, activeCount, archivedCount] = await Promise.all([
      Note.countDocuments(trashQuery),
      Note.find(trashQuery)
        .populate('userId', 'username email')
        .populate('sharedWith', 'username email')
        .sort({ deletedAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      Note.countDocuments(buildNotesQuery({ userId, isArchived: false })),
      Note.countDocuments(buildNotesQuery({ userId, isArchived: true }))
    ]);

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
  const [total, activeCount, archivedCount, trashCount, tags] = await Promise.all([
    Note.countDocuments(query),
    Note.countDocuments(activeQuery),
    Note.countDocuments(archivedQuery),
    Note.countDocuments({ userId, deletedAt: { $ne: null } }),
    Note.aggregate([
      { $match: tagMatch },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, name: '$_id', count: 1 } }
    ])
  ]);

  // Bei einer Suche zählt Relevanz (gewichteter textScore) mehr als Recency;
  // angeheftete Notizen bleiben oben. Ohne Suche gilt die gewohnte Ordnung.
  const listQuery = isSearch
    ? Note.find(query, { score: { $meta: 'textScore' } })
    : Note.find(query);
  const notes = await listQuery
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
    .populate('lastEditedBy', 'username');

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
  const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews, remindAt, order, parentId, isCode } = noteData;

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

  // Baum: Verschieben nur auf eigene, nicht geloeschte Eltern ohne Zyklus.
  // null loest die Notiz vom Baum (Wurzel), undefined laesst sie unangetastet.
  if (parentId !== undefined) {
    await assertValidParent(userId, noteId, parentId);
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
  if (order !== undefined) {
    $set.order = order;
  }

  // Baum + Code-Notiz (v1.10.0): undefined laesst beide unangetastet; null
  // loest die Notiz vom Baum. assertValidParent lief oben bereits.
  if (parentId !== undefined) {
    $set.parentId = parentId ?? null;
  }
  if (isCode !== undefined) {
    $set.isCode = isCode;
  }

  // Nachvollziehbarkeit bei geteilten Notizen: Wer hat zuletzt geändert?
  $set.lastEditedBy = userId;

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
    { $set },
    { new: true, runValidators: true }
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
    { new: true }
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
    { new: true }
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
  return note;
}

/**
 * Empty the trash: remove every soft-deleted note of the user plus their files.
 * @param {string} userId
 * @returns {Promise<number>} Count of permanently removed notes
 */
async function emptyTrash(userId) {
  const notes = await Note.find({ userId, deletedAt: { $ne: null } }).select('images parentId');
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
  await Promise.all(notes.map(note => deleteNoteImages(note)));
  return deleted.deletedCount ?? notes.length;
}

/**
 * Baum-Übersicht (v1.10.0): Leichte Projektion aller aktiven und archivierten
 * Notizen — alles, was ein Baum-Panel braucht, ohne Inhalte und Bilder. Der
 * Client verschachtelt die Liste selbst; ein Server-seitiger Baum waere nur
 * eine teurere Art, dasselbe JSON zu liefern.
 * @param {string} userId
 * @returns {Promise<Array>} Flache Liste mit _id, parentId, title, order, Flags
 */
async function getNoteTree(userId) {
  const notes = await Note.find({
    userId,
    deletedAt: null
  })
    .select('parentId title order isPinned isCode isArchived isTodoList remindAt updatedAt')
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
    updatedAt: note.updatedAt
  }));
}

/**
 * Markdown-Export des Baums (v1.10.0) als ZIP: Jede Notiz wird eine .md-Datei,
 * jede Notiz mit Kindern ein Verzeichnis mit _index.md plus den Kindern. Das
 * Ergebnis ist ein Round-trip-Partner zum Trilium-/Markdown-Ordner-Import und
 * zugleich ein lesbares Volldaten-Backup (abzüglich Bilder und Todo-Status).
 * Archivierte Notizen kommen mit, geloeschte nicht.
 * @param {string} userId
 * @returns {Promise<Buffer>} ZIP-Archiv
 */
async function buildMarkdownExport(userId) {
  const notes = await Note.find({ userId, deletedAt: null })
    .select('parentId title content isTodoList todoItems tags isCode order isArchived isPinned createdAt')
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

  const renderMarkdown = (note) => {
    const lines = [];
    if (note.title) lines.push(`# ${note.title}`, '');
    if (note.tags && note.tags.length > 0) {
      lines.push(note.tags.map((tag) => `#${tag}`).join(' '), '');
    }
    if (note.isTodoList) {
      for (const item of note.todoItems || []) {
        lines.push(`- [${item.completed ? 'x' : ' '}] ${item.text}`);
      }
    } else if (note.content) {
      lines.push(note.content);
    }
    return lines.join('\n').replace(/\s+$/, '') + '\n';
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

async function importMarkdownNotes(userId, rawItems, { demoLimit = null } = {}) {
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
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map(tag => (typeof tag === 'string' ? tag.trim().slice(0, 50) : '')).filter(Boolean)
      : [];
    if (tags.length > 50) throw clientError(`items[${index}] hat mehr als 50 Tags`);
    return {
      path,
      segments,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 200) : 'Notiz',
      content: typeof raw.content === 'string' ? raw.content.slice(0, 10000) : '',
      tags
    };
  });

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
    const existingId = idByParentTitle.get(`${parentId ? String(parentId) : ''}|${title}`);
    if (existingId) {
      folderIdByPath.set(folderPath, existingId);
      continue;
    }
    const folderId = new mongoose.Types.ObjectId();
    folderIdByPath.set(folderPath, String(folderId));
    idByParentTitle.set(`${parentId ? String(folderId) : ''}|${title}`, String(folderId));
    newFolders.push({ _id: folderId, title, content: '', parentId, userId, order: 0, tags: [] });
  }

  // 5) Demo-Budget: Einzel-Creates prueft enforceDemoNoteLimit (Bestand < Limit),
  //    hier muss die Chunk-Groesse mitrechnen, sonst sprengt ein Rutsch das Limit.
  if (demoLimit != null) {
    const noteCount = await Note.countDocuments({ userId, deletedAt: null });
    if (noteCount + items.length + newFolders.length > demoLimit) {
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
  const newNotes = items.map((item, index) => ({
    title: item.title,
    content: item.content,
    tags: item.tags,
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
  if (action === 'delete') {
    const result = await Note.updateMany(
      { ...baseQuery, tags: { $in: sources } },
      [{ $set: {
        tags: { $filter: { input: '$tags', cond: { $not: [{ $in: ['$$this', sources] }] } } },
        updatedAt: editedAt,
        lastEditedBy: userId
      } }]
    );
    return { action, modified: result.modifiedCount };
  }

  // rename/merge: Quell-Tags herausfiltern, Ziel per setUnion dazugeben —
  // eine Notiz mit zwei Quell-Tags endet mit genau einem Ziel-Tag.
  const result = await Note.updateMany(
    { ...baseQuery, tags: { $in: sources } },
    [{ $set: {
      tags: { $setUnion: [
        { $filter: { input: '$tags', cond: { $not: [{ $in: ['$$this', sources] }] } } },
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
    { new: true }
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
    { new: true }
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
      new: true, // Return updated document
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
      new: true, // Return updated document
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
      new: true,
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
      new: true,
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
  buildMarkdownExport,
  importMarkdownNotes,
  applyTagOperation,
  addImages,
  removeImage,
  generateThumbnail, // Export for use in routes
  validateImageDimensions,
  deleteNoteImages, // Export for use in adminService
  buildNotesQuery, // Export for testing
  normalizePositiveInteger,
  validateNoteContent,
  validateNoteFields,
};
