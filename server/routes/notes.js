/**
 * Notes Routes
 * HTTP endpoints for note operations
 * Business logic is in notesService
 */

const express = require('express');
const router = express.Router();
const noteValidation = require('../middleware/validators');
const { authenticateToken } = require('../middleware/auth');
const { upload, uploadAudio } = require('../middleware/upload');
const { fetchLinkPreview } = require('../utils/linkPreview');
const { validateImageFiles } = require('../utils/magicNumberValidator');
const { notesService, aiService } = require('../services');
const { httpStatus } = require('../constants');

// All routes require authentication
router.use(authenticateToken);

/**
 * DEBUG: List uploaded images in the uploads directory
 */
router.get('/debug/uploads', async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(httpStatus.FORBIDDEN).json({ error: 'Nur für Admins zugänglich' });
    }

    const path = require('path');
    const fs = require('fs');
    const uploadsDir = path.join(__dirname, '../uploads/images');

    console.log('[DEBUG] Checking uploads directory:', uploadsDir);
    console.log('[DEBUG] Directory exists:', fs.existsSync(uploadsDir));

    if (!fs.existsSync(uploadsDir)) {
      return res.json({
        error: 'Uploads directory does not exist',
        path: uploadsDir,
        exists: false
      });
    }

    const files = fs.readdirSync(uploadsDir);
    const fileStats = files.map(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      return {
        filename: file,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    });

    res.json({
      uploadsDir,
      fileCount: files.length,
      files: fileStats
    });
  } catch (error) {
    console.error('[DEBUG] Error listing uploads:', error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/notes - Get all notes with optional filtering and pagination
 */
router.get('/', noteValidation.search, async (req, res, next) => {
  try {
    const { search, tag, page, limit, archived } = req.query;

    const result = await notesService.getAllNotes({
      userId: req.user._id,
      search,
      tag,
      page,
      limit,
      archived
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
router.post('/', noteValidation.create, async (req, res, next) => {
  try {
    const savedNote = await notesService.createNote(req.body, req.user._id);
    res.status(httpStatus.CREATED).json(savedNote);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(httpStatus.BAD_REQUEST).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * PUT /api/notes/:id - Update an existing note
 */
router.put('/:id', noteValidation.update, async (req, res, next) => {
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
 * DELETE /api/notes/:id - Delete a note
 */
router.delete('/:id', noteValidation.delete, async (req, res, next) => {
  try {
    const deletedNote = await notesService.deleteNote(req.params.id, req.user._id);
    res.json({ message: 'Notiz gelöscht', note: deletedNote });
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
router.post('/:id/archive', async (req, res, next) => {
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
router.post('/:id/share', async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.body;
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
router.delete('/:id/share/:userId', async (req, res, next) => {
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
router.post('/link-preview', async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'URL ist erforderlich' });
    }

    const preview = await fetchLinkPreview(url);
    res.json(preview);
  } catch (error) {
    console.error('Error fetching link preview:', error);
    const status = error.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
    res.status(status).json({
      error: status === httpStatus.INTERNAL_SERVER_ERROR
        ? 'Fehler beim Abrufen der Link-Vorschau'
        : error.message
    });
  }
});

/**
 * POST /api/notes/:id/images - Upload images to a note
 * Supports multiple files (max 5 images per request)
 */
router.post('/:id/images', (req, res, next) => {
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

    console.log(`[IMAGE UPLOAD] Received ${req.files.length} files for note ${req.params.id}`);

    // Files are currently in TEMP directory (security measure)
    const tempFilePaths = req.files.map(file => file.path);
    tempFiles.push(...tempFilePaths);

    req.files.forEach(file => {
      console.log(`[IMAGE UPLOAD] Temp file: ${file.filename}, Size: ${file.size} bytes, Path: ${file.path}`);
    });

    // SECURITY: Validate files in temp directory BEFORE moving to final location
    console.log('[IMAGE UPLOAD] Validating files with magic number checking...');
    const filepaths = tempFilePaths;

    const validationResult = await validateImageFiles(filepaths);

    if (validationResult.invalid.length > 0) {
      console.warn('[IMAGE UPLOAD] ✗ Magic number validation FAILED:', validationResult.invalid);
      // SECURITY: Delete ALL temp files (reject entire batch if one is invalid)
      tempFilePaths.forEach(filepath => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          console.log(`[IMAGE UPLOAD] Deleted invalid temp file: ${filepath}`);
        }
      });

      return res.status(httpStatus.BAD_REQUEST).json({
        error: 'Ungültige Bilddateien erkannt. Die hochgeladenen Dateien sind keine echten Bilder.'
      });
    }

    console.log('[IMAGE UPLOAD] ✓ All files passed magic number validation');

    // Move validated files from temp to final directory and generate thumbnails
    const imageDataPromises = req.files.map(async file => {
      const tempPath = file.path;
      const finalPath = path.join(finalUploadDir, file.filename);

      // ATOMIC MOVE: Move file from temp to final directory
      console.log(`[IMAGE UPLOAD] Moving ${file.filename} from temp to final directory`);
      fs.renameSync(tempPath, finalPath);
      console.log(`[IMAGE UPLOAD] ✓ File moved to production directory`);

      // Generate thumbnail in final directory
      console.log(`[IMAGE UPLOAD] Generating thumbnail for: ${file.filename}`);
      const thumbnailFilename = await notesService.generateThumbnail(file.filename, finalPath);

      if (thumbnailFilename) {
        console.log(`[IMAGE UPLOAD] ✓ Thumbnail created: ${thumbnailFilename}`);
      } else {
        console.warn(`[IMAGE UPLOAD] ⚠ Thumbnail generation failed for: ${file.filename}`);
      }

      return {
        url: `/uploads/images/${file.filename}`,
        filename: file.filename,
        thumbnailUrl: thumbnailFilename ? `/uploads/images/${thumbnailFilename}` : '',
        thumbnailFilename: thumbnailFilename,
        uploadedAt: new Date()
      };
    });

    const imageData = await Promise.all(imageDataPromises);

    console.log(`[IMAGE UPLOAD] Saving ${imageData.length} images to note ${req.params.id}`);
    const note = await notesService.addImages(req.params.id, req.user._id, imageData);

    console.log(`[IMAGE UPLOAD] Successfully saved images to note. Response data:`, {
      noteId: note._id,
      imageCount: note.images?.length,
      latestImages: note.images?.slice(-imageData.length)
    });
    res.json(note);
  } catch (error) {
    console.error('[IMAGE UPLOAD] ✗ Error during upload:', error);

    // Clean up: Delete files from temp directory (if still there)
    tempFiles.forEach(filepath => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`[IMAGE UPLOAD] Cleaned up temp file after error: ${filepath}`);
      }
    });

    // Clean up: Delete files from final directory and thumbnails (if already moved)
    if (req.files) {
      req.files.forEach(file => {
        const finalPath = path.join(finalUploadDir, file.filename);
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
          console.log(`[IMAGE UPLOAD] Cleaned up final file after error: ${file.filename}`);
        }

        // Clean up thumbnail if exists
        const ext = path.extname(file.filename);
        const nameWithoutExt = path.basename(file.filename, ext);
        const thumbpath = path.join(finalUploadDir, `${nameWithoutExt}-thumb.webp`);
        if (fs.existsSync(thumbpath)) {
          fs.unlinkSync(thumbpath);
          console.log(`[IMAGE UPLOAD] Cleaned up thumbnail after error: ${nameWithoutExt}-thumb.webp`);
        }
      });
    }

    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
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
router.delete('/:id/images/:filename', async (req, res, next) => {
  try {
    console.log(`[IMAGE DELETE] Deleting image ${req.params.filename} from note ${req.params.id}`);

    const note = await notesService.removeImage(
      req.params.id,
      req.user._id,
      req.params.filename
    );

    // Delete file from filesystem
    const fs = require('fs');
    const path = require('path');
    const filepath = path.join(__dirname, '../uploads/images', req.params.filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log(`[IMAGE DELETE] Deleted original file: ${req.params.filename}`);
    } else {
      console.warn(`[IMAGE DELETE] Original file not found: ${filepath}`);
    }

    // Also delete thumbnail if it exists
    const ext = path.extname(req.params.filename);
    const nameWithoutExt = path.basename(req.params.filename, ext);
    const thumbnailFilename = `${nameWithoutExt}-thumb.webp`;
    const thumbpath = path.join(__dirname, '../uploads/images', thumbnailFilename);

    if (fs.existsSync(thumbpath)) {
      fs.unlinkSync(thumbpath);
      console.log(`[IMAGE DELETE] Deleted thumbnail: ${thumbnailFilename}`);
    } else {
      console.log(`[IMAGE DELETE] No thumbnail found: ${thumbnailFilename}`);
    }

    console.log(`[IMAGE DELETE] Successfully deleted image from note ${req.params.id}`);
    res.json(note);
  } catch (error) {
    console.error('[IMAGE DELETE] Error:', error);
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
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
router.post('/:id/transcribe', (req, res, next) => {
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

    console.log(`[TRANSCRIPTION] Processing file ${req.file.filename} for note ${req.params.id}`);
    console.log(`[TRANSCRIPTION] File path: ${req.file.path}, Size: ${req.file.size} bytes`);

    // Get language parameter from request body (optional)
    const language = req.body.language || null;
    if (language) {
      console.log(`[TRANSCRIPTION] Language specified: ${language}`);
    }

    // 1. Call AI Service for transcription
    const result = await aiService.transcribeAudio(req.file.path, language);

    // 2. Delete temp audio file (we don't store audio permanently, only the text)
    // If you want to keep audio, move it like images to finalUploadDir
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('[TRANSCRIPTION] Failed to delete temp audio:', err);
      else console.log(`[TRANSCRIPTION] ✓ Deleted temp file: ${req.file.filename}`);
    });

    if (!result || !result.text) {
      throw new Error('Keine Transkription erhalten');
    }

    console.log(`[TRANSCRIPTION] ✓ Transcribed (${result.language}): "${result.text.substring(0, 100)}..."`);

    // 3. Return transcription result (frontend will handle appending to note)
    res.json({
      message: 'Transkription erfolgreich',
      text: result.text,
      language: result.language,
      probability: result.probability
    });

  } catch (error) {
    // Cleanup temp file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`[TRANSCRIPTION] Cleaned up temp file after error: ${req.file.filename}`);
    }

    console.error('[TRANSCRIPTION ERROR]', error);

    // 503 if AI service is down
    if (error.message.includes('nicht erreichbar')) {
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
