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
const { upload, uploadAudio, isSafeStoredFilename } = require('../middleware/upload');
const { getLinkPreview } = require('../services/linkPreviewService');
const { acquire } = require('../utils/concurrencyGate');
const { validateImageFiles, validateAudioFile } = require('../utils/magicNumberValidator');
const notesService = require('../services/notesService');
const aiService = require('../services/aiService');
const { httpStatus } = require('../constants');
const {
  blockDemoUser,
  enforceDemoNoteLimit,
  rejectDemoNoteCapabilities
} = require('../middleware/demoPolicy');

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
// Gunicorn laeuft mit `--workers 1` (ai/Dockerfile, supervisord.conf): Der
// AI-Dienst kann genau eine Transkription gleichzeitig bedienen. Ein Gate ueber
// 1 wuerde den zweiten Request also nicht abweisen, sondern bis zum
// Axios-Timeout (300 s) warten lassen — der Nutzer sieht einen haengenden
// Spinner statt eines ehrlichen 429. Wer `--workers N` konfiguriert (RAM!),
// setzt MAX_CONCURRENT_TRANSCRIPTIONS=N dazu.
const MAX_CONCURRENT_TRANSCRIPTIONS = numberFromEnv('MAX_CONCURRENT_TRANSCRIPTIONS', 1);

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

/**
 * Zugriff für Mitbearbeiter: eigene oder geteilte Notiz. Wird für Uploads und
 * Transkription verwendet — beides ändert den Inhalt, den auch geteilte Nutzer
 * bearbeiten dürfen. Destruktives (Löschen, Archiv, Teilen) bleibt beim Besitzer.
 */
async function requireEditableNote(req, res, next) {
  try {
    req.ownedNote = await notesService.getEditableNoteById(req.params.id, req.user._id);
    next();
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    return next(error);
  }
}

/**
 * GET /api/notes - Get all notes with optional filtering and pagination
 */
router.get('/', noteValidation.search, async (req, res, next) => {
  try {
    const { search, tag, page, limit, archived, deleted } = req.query;

    const result = await notesService.getAllNotes({
      userId: req.user._id,
      search,
      tag,
      page,
      limit,
      archived,
      deleted
    });

    res.json(result);
  } catch (error) {
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
router.post('/:id/images', blockDemoUploads, noteValidation.getOne, requireEditableNote, (req, res, next) => {
  if ((req.ownedNote.images?.length || 0) >= 25) {
    return res.status(httpStatus.BAD_REQUEST).json({ error: 'Maximal 25 Bilder pro Notiz erlaubt' });
  }

  // Wrap multer to catch file size and other errors
  upload.array('images', 5)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(httpStatus.BAD_REQUEST).json({
          error: 'Datei zu groß. Maximale Dateigröße: 10MB'
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(httpStatus.BAD_REQUEST).json({
          error: 'Zu viele Dateien. Maximal 5 Bilder pro Upload.'
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
  const path = require('path');
  const fs = require('fs');
  const { tempUploadDir, finalUploadDir } = require('../middleware/upload');
  const tempFiles = []; // Track temp files for cleanup

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Keine Bilder hochgeladen' });
    }

    if ((req.ownedNote.images?.length || 0) + req.files.length > 25) {
      await Promise.all(req.files.map(file => fs.promises.rm(file.path, { force: true })));
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Maximal 25 Bilder pro Notiz erlaubt' });
    }

    // Files are currently in TEMP directory (security measure)
    const tempFilePaths = req.files.map(file => file.path);
    tempFiles.push(...tempFilePaths);

    // Validate files in temp before moving anything into the served directory.
    const validationResult = await validateImageFiles(req.files.map(file => ({
      filepath: file.path,
      mimetype: file.mimetype
    })));

    if (validationResult.invalid.length > 0) {
      await Promise.all(tempFilePaths.map(filepath => fs.promises.rm(filepath, { force: true })));

      return res.status(httpStatus.BAD_REQUEST).json({
        error: 'Ungültige Bilddateien erkannt. Die hochgeladenen Dateien sind keine echten Bilder.'
      });
    }

    await notesService.validateImageDimensions(tempFilePaths);

    // Process sequentially so cleanup cannot race unfinished thumbnail jobs.
    const imageData = [];
    for (const file of req.files) {
      const tempPath = file.path;
      const finalPath = path.join(finalUploadDir, file.filename);

      await fs.promises.rename(tempPath, finalPath);
      const thumbnailFilename = await notesService.generateThumbnail(file.filename, finalPath);

      imageData.push({
        url: `/uploads/images/${file.filename}`,
        filename: file.filename,
        thumbnailUrl: thumbnailFilename ? `/uploads/images/${thumbnailFilename}` : '',
        thumbnailFilename: thumbnailFilename,
        uploadedAt: new Date()
      });
    }

    const note = await notesService.addImages(req.params.id, req.user._id, imageData);
    res.json(note);
  } catch (error) {
    console.error('[IMAGE UPLOAD] ✗ Error during upload:', error);

    // Clean up: Delete files from temp directory (if still there)
    tempFiles.forEach(filepath => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });

    // Clean up: Delete files from final directory and thumbnails (if already moved)
    if (req.files) {
      req.files.forEach(file => {
        const finalPath = path.join(finalUploadDir, file.filename);
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }

        // Clean up thumbnail if exists
        const ext = path.extname(file.filename);
        const nameWithoutExt = path.basename(file.filename, ext);
        const thumbpath = path.join(finalUploadDir, `${nameWithoutExt}-thumb.webp`);
        if (fs.existsSync(thumbpath)) {
          fs.unlinkSync(thumbpath);
        }
      });
    }

    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'Fehler beim Hochladen der Bilder',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

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
    const filepath = path.join(__dirname, '../uploads/images', req.params.filename);

    await fs.promises.rm(filepath, { force: true });

    // Also delete thumbnail if it exists
    const ext = path.extname(req.params.filename);
    const nameWithoutExt = path.basename(req.params.filename, ext);
    const thumbnailFilename = `${nameWithoutExt}-thumb.webp`;
    const thumbpath = path.join(__dirname, '../uploads/images', thumbnailFilename);

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
