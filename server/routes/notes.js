/**
 * Notes Routes
 * HTTP endpoints for note operations
 * Business logic is in notesService
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const noteValidation = require('../middleware/validators');
const { authenticateToken } = require('../middleware/auth');
const { upload, uploadAudio, uploadPdf, uploadZip, isSafeStoredFilename } = require('../middleware/upload');
const { getLinkPreview } = require('../services/linkPreviewService');
const { acquire } = require('../utils/concurrencyGate');
const { validateAudioFile } = require('../utils/magicNumberValidator');
const notesService = require('../services/notesService');
const aiService = require('../services/aiService');
const { httpStatus } = require('../constants');
const { imagesDir, filesDir } = require('../config/paths');
const {
  blockDemoUser,
  enforceDemoNoteLimit,
  rejectDemoNoteCapabilities,
  parseDemoNoteLimit
} = require('../middleware/demoPolicy');
// Geteilte Upload-Pipeline (v1.15.0): dieselben Handler laufen auch hinter der
// v1-API — Validierung und Limits driften damit nicht zwischen Session und
// API-Key auseinander.
const {
  requireEditableNote,
  rejectIfAttachmentFull,
  wrapUpload,
  handleImageUpload,
  handleFileUpload
} = require('../utils/attachmentUpload');

const blockDemoCollaboration = blockDemoUser('collaboration');
const blockDemoLinkPreview = blockDemoUser('link_preview');
const blockDemoUploads = blockDemoUser('uploads');
const blockDemoTranscription = blockDemoUser('transcription');

// Teure Endpunkte brauchen eigene Budgets: Der globale Limiter (500/15 min pro
// IP) schützt weder den Whisper-Worker (ein Request blockiert bis zu 300 s alle
// anderen) noch den ausgehenden Traffic der Link-Vorschau. Die Zähler sind
// pro Nutzer, nicht pro IP — hinter einem Reverse Proxy teilen sich sonst alle
// ein Budget. (In-Memory-Store: gilt pro Server-Prozess, was bei den
// Ein-Container-Deployments genau einem Instanz entspricht.)
const numberFromEnv = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const userKeyGenerator = (req) => `user:${req.user?._id ? String(req.user._id) : req.ip}`;

const tooManyRequests = (code, message, retryAfterSeconds) => (req, res) => {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(httpStatus.TOO_MANY_REQUESTS).json({ code, error: message });
};

const LINK_PREVIEW_LIMIT_PER_MINUTE = numberFromEnv('LINK_PREVIEW_LIMIT_PER_MINUTE', 30);
const TRANSCRIPTION_LIMIT_PER_HOUR = numberFromEnv('TRANSCRIPTION_LIMIT_PER_HOUR', 10);
const TRANSCRIPTION_LIMIT_PER_DAY = numberFromEnv('TRANSCRIPTION_LIMIT_PER_DAY', 60);
// Audit 2026-09-12 (Top-30 Nr. 18): Anfrage-Zähler sind kein Audio-Budget — 60
//× 25 MB am Tag können Stunden Material sein. Die AI-Service begrenzt die
// Einzellänge (MAX_AUDIO_SECONDS → 413), hier läuft das Tagesbudget in
// Audio-Minuten zusammen. In-Memory wie die Limiter oben: pro Server-Prozess.
const TRANSCRIPTION_MINUTES_PER_DAY = numberFromEnv('TRANSCRIPTION_MINUTES_PER_DAY', 120);
// Gunicorn laeuft mit `--workers 1` (ai/Dockerfile, supervisord.conf): Der
// AI-Dienst kann genau eine Transkription gleichzeitig bedienen. Ein Gate ueber
// 1 wuerde den zweiten Request also nicht abweisen, sondern bis zum
// Axios-Timeout (300 s) warten lassen — der Nutzer sieht einen haengenden
// Spinner statt eines ehrlichen 429. Wer `--workers N` konfiguriert (RAM!),
// setzt MAX_CONCURRENT_TRANSCRIPTIONS=N dazu.
const MAX_CONCURRENT_TRANSCRIPTIONS = numberFromEnv('MAX_CONCURRENT_TRANSCRIPTIONS', 1);

// Tagesbudget in Audio-Minuten, geladen aus der `duration`-Angabe, die die
// AI-Service mit jeder erfolgreichen Transkription zurueckmeldet. Abgerechnet
// wird nach Erfolg; der Vorab-Check verweigert erst, wenn das Budget erschoepft
// ist (ein Ueberschreiten um eine Aufnahme ist moeglich und ok — die Einzellänge
// deckelt die AI-Service per 413).
const audioMinuteBudgets = new Map(); // userId -> { resetAt, usedSeconds }

function audioBudgetRetryAfterSeconds(entry) {
  return Math.min(3600, Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)));
}

function audioMinutesExhausted(userId) {
  const entry = audioMinuteBudgets.get(String(userId));
  if (!entry) return 0;
  if (Date.now() >= entry.resetAt) {
    audioMinuteBudgets.delete(String(userId));
    return 0;
  }
  return entry.usedSeconds >= TRANSCRIPTION_MINUTES_PER_DAY * 60
    ? audioBudgetRetryAfterSeconds(entry)
    : 0;
}

function chargeAudioMinutes(userId, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const key = String(userId);
  const now = Date.now();
  let entry = audioMinuteBudgets.get(key);
  if (!entry || now >= entry.resetAt) {
    // Rolling 24-h window from the first transcription of the day.
    entry = { resetAt: now + 24 * 60 * 60 * 1000, usedSeconds: 0 };
    audioMinuteBudgets.set(key, entry);
  }
  entry.usedSeconds += seconds;
}

const linkPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: LINK_PREVIEW_LIMIT_PER_MINUTE,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests(
    'LINK_PREVIEW_RATE_LIMITED',
    'Zu viele Link-Vorschauen in kurzer Zeit. Bitte einen Moment warten.',
    60
  )
});

const transcribeHourLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: TRANSCRIPTION_LIMIT_PER_HOUR,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests(
    'TRANSCRIPTION_RATE_LIMITED',
    'Stundenlimit für Transkriptionen erreicht. Bitte später erneut versuchen.',
    600
  )
});

const transcribeDayLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: TRANSCRIPTION_LIMIT_PER_DAY,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests(
    'TRANSCRIPTION_DAILY_LIMIT',
    'Tageslimit für Transkriptionen erreicht. Bitte morgen erneut versuchen.',
    3600
  )
});

// All routes require authentication
router.use(authenticateToken);
// requireEditableNote (eigene oder geteilte Notiz als req.ownedNote) wohnt seit
// v1.15.0 in utils/attachmentUpload — gemeinsam mit der Upload-Pipeline, die
// sie neben der Session-Route auch die v1-API benutzt.

// Baum-Panel (v1.10.0): Muss VOR /:id registriert sein, sonst frisst der
// Param-Route-Match „tree" als Notiz-ID.

/**
 * GET /api/notes/tree - Leichte Baum-Übersicht (id, parentId, title, Flags)
 * für Sidebar-/Schubladen-Bäume, ohne Inhalte und Bilder.
 */
router.get('/tree', async (req, res, next) => {
  try {
    const tree = await notesService.getNoteTree(req.user._id, req.query.since);
    res.json(tree);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notes/meta - Billige Änderungs-Sonde für den 60s-Poll (v1.13.0):
 * {active, archived, trash, maxUpdatedAt}. Muss VOR /:id registriert sein.
 */
router.get('/meta', async (req, res, next) => {
  try {
    res.json(await notesService.getNotesMeta(req.user._id));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notes/export/markdown - Gesamter Baum als Markdown-ZIP (Round-trip
 * zum Trilium-/Ordner-Import, zugleich lesbares Backup).
 *
 * Hinter einem Concurrency-Gate pro Nutzer (v1.16.0): Der Export liest jede
 * Anhangs-Datei und haelt alle Bytes plus das fertige Archiv im RAM. Ein zweiter
 * paralleler Antrag desselben Nutzers (Doppelklick, zweites Tab, read-only
 * API-Key ueber die v1-Route) waere ein OOM-Vektor gegen das All-in-One-Image,
 * in dem mongod und Whisper mit auf dem Host liegen — der Import-Endpunkt
 * gate't exakt dieses Profil seit v1.15.0 (siehe unten).
 */
router.get('/export/markdown', async (req, res, next) => {
  const gate = acquire(`export:${req.user._id}`, 1);
  if (!gate.acquired) {
    res.setHeader('Retry-After', '30');
    return res.status(httpStatus.TOO_MANY_REQUESTS).json({
      code: 'EXPORT_BUSY',
      error: 'Es läuft bereits ein Export. Bitte in einer halben Minute erneut versuchen.'
    });
  }
  try {
    const archive = await notesService.buildMarkdownExport(req.user._id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="keeplocal-export.zip"');
    res.end(archive);
  } catch (error) {
    next(error);
  } finally {
    gate.release();
  }
});

/**
 * POST /api/notes/import/markdown (v1.10.1) — Bulk-Import eines Ordner-Chunks.
 * Der Web-Client schickte vorher eine Create-Request pro Datei; ein 300-Notizen-
 * Trilium-Export war eine 300+-Request-Sequenz mit halbem Import bei Abbruch.
 * Route vor '/:id'-Mustern registriert (wie export/markdown).
 */
router.post(
  '/import/markdown',
  noteValidation.importMarkdown,
  async (req, res, next) => {
    try {
      const result = await notesService.importMarkdownNotes(req.user._id, req.body.items, {
        // Demo-Budget: der Service rechnet Bestand + Chunk-Groesse gegen das
        // Limit — enforceDemoNoteLimit prueft nur den Bestand und wuerde einen
        // Rutsch durchlassen.
        demoLimit: req.user?.isDemo ? parseDemoNoteLimit() : null
      });
      res.status(httpStatus.CREATED).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notes/import/markdown-zip (v1.13.0) — der Empfangsteil des
 * Round-trips zu GET /export/markdown: Export-ZIP (oder fremder Markdown-
 * Ordner als ZIP) als multipart-Datei, serverseitig gelesen inklusive
 * Frontmatter, Anhaengen und Baumstruktur. Demo-Konten bleiben draussen —
 * der Import schreibt Bilddateien auf die Platte (blockDemoUploads wie bei
 * den Upload-Routen), das reine Text-Import-Ersatzlicht bleibt /import/markdown.
 *
 * Hinter einem Concurrency-Gate (Review v1.15.0): readFileSync + Reader +
 * Entpacken halten ein komplettes Archiv (bis 512 MB Multer-Limit) im RAM —
 * mehrere parallele Importe desselben Nutzers wären ein OOM-Vektor gegen das
 * All-in-One-Image, in dem mongod und Whisper mit im Prozessraum des Hosts
 * liegen. Ein zweiter Antrag bekommt 429 + Retry-After statt zu queueing.
 */
router.post('/import/markdown-zip', blockDemoUploads, (req, res, next) => {
  // Wrap multer, um Dateigroessen-/Filter-Fehler als normalen Fehlerweg zu
  // fassen (Muster wie /:id/images).
  uploadZip.single('archive')(req, res, (err) => {
    if (err) return next(err);
    Promise.resolve()
      .then(async () => {
        const fs = require('fs');
        if (!req.file) {
          return res.status(httpStatus.BAD_REQUEST).json({ message: 'archive (ZIP-Datei) ist erforderlich' });
        }
        const gate = acquire('zipImport', 1);
        if (!gate.acquired) {
          res.setHeader('Retry-After', '30');
          return res.status(httpStatus.TOO_MANY_REQUESTS).json({
            code: 'ZIP_IMPORT_BUSY',
            error: 'Es läuft bereits ein ZIP-Import. Bitte in einer halben Minute erneut versuchen.'
          });
        }
        try {
          const buffer = fs.readFileSync(req.file.path);
          const result = await notesService.importMarkdownZip(req.user._id, buffer, {
            demoLimit: req.user?.isDemo ? parseDemoNoteLimit() : null
          });
          res.status(httpStatus.CREATED).json(result);
        } finally {
          gate.release();
        }
      })
      .catch(next)
      .finally(() => {
        // Temp-Datei immer weg — auch bei Fehlern bleibt nichts liegen.
        if (req.file?.path) {
          require('fs').unlink(req.file.path, () => {});
        }
      });
  });
});

/**
 * GET /api/notes - Get all notes with optional filtering and pagination
 */
router.get('/', noteValidation.search, async (req, res, next) => {
  try {
    const { search, tag, page, limit, archived, deleted, folderId, since } = req.query;

    const result = await notesService.getAllNotes({
      userId: req.user._id,
      search,
      tag,
      page,
      limit,
      archived,
      deleted,
      folderId,
      since,
      // v1.14.0: Folgeseiten (und nur diese) verzichten auf Counts/Tag-Cloud.
      includeMeta: req.query.includeMeta
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------------
// Notiz-Historie (v1.13.0)
// -------------------------------------------------------------------------

/**
 * GET /api/notes/:id/revisions - Revisionsliste (Metadaten) oder mit ?at=ISO
 * den Volltext einer Fassung. Muss VOR /:id registriert sein.
 */
router.get('/:id/revisions', noteValidation.getOne, async (req, res, next) => {
  try {
    if (req.query.at) {
      const revision = await notesService.getNoteRevision(req.params.id, req.user._id, String(req.query.at));
      return res.json(revision);
    }
    const revisions = await notesService.getNoteRevisions(req.params.id, req.user._id);
    res.json(revisions);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * POST /api/notes/:id/revisions/restore - Fassung wiederherstellen.
 * Läuft als normales updateNote: Der aktuelle Stand wird selbst zur jüngsten
 * Revision, Konflikte (409) inklusive.
 */
router.post('/:id/revisions/restore', rejectDemoNoteCapabilities, noteValidation.getOne, async (req, res, next) => {
  try {
    if (!req.body || typeof req.body.at !== 'string' || req.body.at.trim() === '') {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'at (ISO-Zeitpunkt der Fassung) ist erforderlich' });
    }
    const note = await notesService.restoreNoteRevision(req.params.id, req.user._id, req.body.at);
    res.json(note);
  } catch (error) {
    if (error.statusCode === httpStatus.CONFLICT) {
      return res.status(httpStatus.CONFLICT).json({ error: error.message, currentNote: error.currentNote });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * GET /api/notes/:id - Get a single note by ID
 */
router.get('/:id', noteValidation.getOne, async (req, res, next) => {
  try {
    const note = await notesService.getNoteById(req.params.id, req.user._id);
    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * POST /api/notes - Create a new note
 */
router.post(
  '/',
  noteValidation.create,
  rejectDemoNoteCapabilities,
  enforceDemoNoteLimit,
  async (req, res, next) => {
    try {
      const savedNote = await notesService.createNote(req.body, req.user._id);
      res.status(httpStatus.CREATED).json(savedNote);
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(httpStatus.BAD_REQUEST).json({ error: error.message });
      }
      next(error);
    }
  }
);

/**
 * PUT /api/notes/:id - Update an existing note
 */
router.put('/:id', noteValidation.update, rejectDemoNoteCapabilities, async (req, res, next) => {
  try {
    const updatedNote = await notesService.updateNote(
      req.params.id,
      req.body,
      req.user._id
    );
    res.json(updatedNote);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.statusCode === httpStatus.CONFLICT) {
      // Optimistic locking: return the stored version alongside the error so
      // clients can merge or reload. currentNote is serialized by res.json
      // exactly like the note in a successful PUT response.
      return res.status(httpStatus.CONFLICT).json({
        error: error.message,
        currentNote: error.currentNote
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.name === 'ValidationError') {
      return res.status(httpStatus.BAD_REQUEST).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * DELETE /api/notes/trash - Papierkorb endgültig leeren
 * Muss VOR '/:id' registriert sein, sonst wird 'trash' als ID geprüft.
 */
router.delete('/trash', async (req, res, next) => {
  try {
    const removed = await notesService.emptyTrash(req.user._id);
    res.json({ message: 'Papierkorb geleert', removed });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notes/tags (v1.11.0) — Tag umbenennen/zusammenführen/überall
 * löschen. Ein updateMany über alle sichtbaren Notizen statt N Einzel-Updates;
 * registriert vor '/:id'-Mustern, damit 'tags' nicht als ID geroutet wird.
 */
router.patch('/tags', noteValidation.tagOperation, async (req, res, next) => {
  try {
    const result = await notesService.applyTagOperation({
      userId: req.user._id,
      action: req.body.action,
      from: req.body.from,
      to: req.body.to
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/notes/reorder - manuelle Reihenfolge nach Drag & Drop speichern.
 * Vor '/:id' registriert, damit 'reorder' nicht als ID geprüft wird.
 */
router.patch('/reorder', noteValidation.reorder, async (req, res, next) => {
  try {
    const result = await notesService.reorderNotes(req.user._id, req.body.orderedIds);
    res.json({ message: 'Reihenfolge gespeichert', ...result });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * POST /api/notes/:id/restore - Notiz aus dem Papierkorb wiederherstellen
 */
router.post('/:id/restore', noteValidation.getOne, async (req, res, next) => {
  try {
    const note = await notesService.restoreNote(req.params.id, req.user._id);
    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * DELETE /api/notes/:id - Delete a note (soft delete into the trash;
 * ?permanent=true removes a trashed note for good, including its images)
 */
router.delete('/:id', noteValidation.remove, async (req, res, next) => {
  try {
    const permanent = req.query.permanent === 'true';
    const deletedNote = permanent
      ? await notesService.purgeNote(req.params.id, req.user._id)
      : await notesService.deleteNote(req.params.id, req.user._id);

    res.json({
      message: permanent ? 'Notiz endgültig gelöscht' : 'Notiz in den Papierkorb verschoben',
      deletedAt: deletedNote.deletedAt || null,
      note: deletedNote
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * POST /api/notes/:id/pin - Toggle pin status of a note
 */
router.post('/:id/pin', noteValidation.pin, async (req, res, next) => {
  try {
    const note = await notesService.togglePinNote(req.params.id, req.user._id);
    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * POST /api/notes/:id/archive - Toggle archive status of a note
 */
router.post('/:id/archive', noteValidation.pin, async (req, res, next) => {
  try {
    const note = await notesService.toggleArchiveNote(req.params.id, req.user._id);
    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * POST /api/notes/:id/share - Share a note with another user
 */
router.post('/:id/share', blockDemoCollaboration, async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.body;
    if (!targetUserId || !/^[a-f\d]{24}$/i.test(targetUserId)) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Ungueltige Benutzer-ID' });
    }
    const note = await notesService.shareNote(
      req.params.id,
      req.user._id,
      targetUserId
    );
    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz oder Benutzer nicht gefunden' });
    }
    next(error);
  }
});

/**
 * DELETE /api/notes/:id/share/:userId - Unshare a note from a user
 */
router.delete('/:id/share/:userId', blockDemoCollaboration, async (req, res, next) => {
  try {
    const note = await notesService.unshareNote(
      req.params.id,
      req.user._id,
      req.params.userId
    );
    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

/**
 * POST /api/notes/link-preview - Fetch link preview for a URL
 */
router.post('/link-preview', blockDemoLinkPreview, linkPreviewLimiter, async (req, res, next) => {
  try {
    const { url } = req.body;

    if (typeof url !== 'string' || !url.trim() || url.length > 2048) {
      return res.status(httpStatus.BAD_REQUEST).json({ code: 'URL_REQUIRED', error: 'URL ist erforderlich und darf maximal 2048 Zeichen lang sein' });
    }

    const { preview, cached } = await getLinkPreview(url.trim());
    res.setHeader('X-Preview-Cache', cached ? 'hit' : 'miss');
    res.json(preview);
  } catch (error) {
    // Expected upstream conditions are not server faults: a dead link, a
    // non-HTML answer, a redirect loop — and equally a DNS failure, a refused
    // connection or a socket timeout of the target host. Reporting those as 500
    // (with a stack trace per pasted link) hides real problems in the log.
    const upstreamNetworkCodes = new Set([
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
      'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT'
    ]);
    const isUpstreamFailure = Boolean(error.statusCode)
      || upstreamNetworkCodes.has(error.code)
      || /timeout/i.test(error.message || '');
    const status = error.statusCode
      || (isUpstreamFailure ? httpStatus.BAD_GATEWAY : httpStatus.INTERNAL_SERVER_ERROR);

    if (status === httpStatus.INTERNAL_SERVER_ERROR) {
      console.error('Error fetching link preview:', error);
    } else {
      console.warn('Link preview skipped:', error.message);
    }

    return res.status(status).json({
      error: status === httpStatus.INTERNAL_SERVER_ERROR
        ? 'Fehler beim Abrufen der Link-Vorschau'
        : (error.statusCode ? error.message : 'Link ist nicht erreichbar')
    });
  }
});

/**
 * POST /api/notes/:id/images - Upload images to a note
 * Supports multiple files (max 5 images per request)
 */
router.post('/:id/images', blockDemoUploads, noteValidation.getOne, requireEditableNote,
  rejectIfAttachmentFull('images'),
  wrapUpload(upload.array('images', 5), { sizeLabel: '10MB', kindLabel: 'Bilder' }),
  handleImageUpload);

/**
 * DELETE /api/notes/:id/images/:filename - Delete an image from a note
 */
router.delete('/:id/images/:filename', blockDemoUploads, noteValidation.getOne, async (req, res, next) => {
  try {
    if (!isSafeStoredFilename(req.params.filename)) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Ungueltiger Dateiname' });
    }

    const note = await notesService.removeImage(
      req.params.id,
      req.user._id,
      req.params.filename
    );

    // Delete file from filesystem
    const fs = require('fs');
    const path = require('path');
    const filepath = path.join(imagesDir(), req.params.filename);

    await fs.promises.rm(filepath, { force: true });

    // Also delete thumbnail if it exists
    const ext = path.extname(req.params.filename);
    const nameWithoutExt = path.basename(req.params.filename, ext);
    const thumbnailFilename = `${nameWithoutExt}-thumb.webp`;
    const thumbpath = path.join(imagesDir(), thumbnailFilename);

    await fs.promises.rm(thumbpath, { force: true });

    res.json(note);
  } catch (error) {
    console.error('[IMAGE DELETE] Error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'Fehler beim Löschen des Bildes',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/notes/:id/files (v1.12.0) — PDF-Anhang an eine Notiz. Gleiche
 * Temp-then-move-Pipeline wie Bilder: multer legt in uploads/temp ab, die
 * Handler prueft Magic Bytes (%PDF) und verschiebt erst dann nach uploads/files.
 */
router.post('/:id/files', blockDemoUploads, noteValidation.getOne, requireEditableNote,
  rejectIfAttachmentFull('files'),
  wrapUpload(uploadPdf.array('files', 5), { sizeLabel: '25MB', kindLabel: 'Anhänge' }),
  handleFileUpload);

/**
 * DELETE /api/notes/:id/files/:filename - Dateianhang von einer Notiz loesen
 */
router.delete('/:id/files/:filename', blockDemoUploads, noteValidation.getOne, async (req, res, next) => {
  try {
    if (!isSafeStoredFilename(req.params.filename)) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Ungueltiger Dateiname' });
    }

    const note = await notesService.removeFile(
      req.params.id,
      req.user._id,
      req.params.filename
    );

    const fs = require('fs');
    const path = require('path');
    await fs.promises.rm(path.join(filesDir(), req.params.filename), { force: true });

    res.json(note);
  } catch (error) {
    console.error('[FILE DELETE] Error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * POST /api/notes/:id/transcribe - Upload audio and append transcription to note
 * Uses Whisper AI service to convert speech to text
 */
router.post('/:id/transcribe', blockDemoTranscription, transcribeHourLimiter, transcribeDayLimiter, noteValidation.getOne, requireEditableNote, (req, res, next) => {
  uploadAudio.single('audio')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(httpStatus.BAD_REQUEST).json({
          error: 'Datei zu groß. Maximale Dateigröße: 25MB'
        });
      }
      if (err.message) {
        return res.status(httpStatus.BAD_REQUEST).json({
          error: err.message
        });
      }
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Upload-Fehler'
      });
    }
    next();
  });
}, async (req, res, next) => {
  const fs = require('fs');

  try {
    if (!req.file) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Keine Audio-Datei gesendet' });
    }

    // Get language parameter from request body (optional).
    // 'auto' is the value the app stores for "detect automatically" — it means
    // "no language hint", so it must not be rejected as an invalid code.
    const rawLanguage = req.body.language || null;
    const language = rawLanguage === 'auto' ? null : rawLanguage;
    if (language && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
      await fs.promises.rm(req.file.path, { force: true });
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Ungueltiger Sprachcode' });
    }

    if (!await validateAudioFile(req.file.path)) {
      await fs.promises.rm(req.file.path, { force: true });
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Ungueltige Audio-Datei' });
    }

    // Tagesbudget in Audio-Minuten (Nr. 18): vor dem Gate pruefen, sonst
    // wuerde ein abgelehnter Request trotzdem den Worker-Slot blockieren.
    const retryAfterExhausted = audioMinutesExhausted(req.user._id);
    if (retryAfterExhausted) {
      await fs.promises.rm(req.file.path, { force: true });
      res.setHeader('Retry-After', String(retryAfterExhausted));
      return res.status(httpStatus.TOO_MANY_REQUESTS).json({
        code: 'TRANSCRIPTION_MINUTE_LIMIT',
        error: 'Tageslimit an Audio-Minuten erreicht. Bitte morgen erneut versuchen.'
      });
    }

    // 1. Call AI Service for transcription — behind a concurrency gate, because
    // the Whisper container runs a single worker: queueing more requests than it
    // can serve only turns them into 300s timeouts.
    const gate = acquire('transcription', MAX_CONCURRENT_TRANSCRIPTIONS);
    if (!gate.acquired) {
      await fs.promises.rm(req.file.path, { force: true });
      res.setHeader('Retry-After', '30');
      return res.status(httpStatus.TOO_MANY_REQUESTS).json({
        code: 'TRANSCRIPTION_BUSY',
        error: 'Der Transkriptionsdienst ist gerade ausgelastet. Bitte in einer halben Minute erneut versuchen.'
      });
    }

    let result;
    try {
      result = await aiService.transcribeAudio(req.file.path, language, req.id);
    } finally {
      gate.release();
    }

    if (!result || typeof result.text !== 'string' || !result.text.trim()) {
      throw new Error('Keine Transkription erhalten');
    }

    await fs.promises.rm(req.file.path, { force: true });
    const transcription = result.text.trim().slice(0, 10000);

    // Erfolgreiche Transkription: Ist-Minuten ins Tagesbudget buchen (Nr. 18).
    if (Number.isFinite(result.duration)) {
      chargeAudioMinutes(req.user._id, result.duration);
    }

    // 3. Return transcription result (frontend will handle appending to note)
    res.json({
      message: 'Transkription erfolgreich',
      text: transcription,
      language: typeof result.language === 'string' ? result.language : null,
      probability: Number.isFinite(result.probability) ? result.probability : null
    });

  } catch (error) {
    // Cleanup temp file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('[TRANSCRIPTION ERROR]', error);

    // 503 if AI service is down
    if (error.message?.includes('nicht erreichbar')) {
      return res.status(httpStatus.SERVICE_UNAVAILABLE).json({ error: error.message });
    }

    // 413: Audio laenger als das Einzellimit (AI-Service, MAX_AUDIO_SECONDS).
    // Der Nutzer kann das beheben (Aufnahme kuerzen) — kein Grund fuer einen 500.
    if (error.statusCode === 413) {
      const minutes = Math.max(1, Math.round((error.maxSeconds || 0) / 60));
      return res.status(httpStatus.PAYLOAD_TOO_LARGE).json({
        code: error.code || 'AUDIO_TOO_LONG',
        error: `Audio ist länger als ${minutes} Minuten. Bitte die Aufnahme kürzen und erneut versuchen.`
      });
    }

    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'Fehler bei der Transkription',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
