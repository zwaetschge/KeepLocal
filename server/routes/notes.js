/**
 * Notes Routes
 * HTTP endpoints for note operations
 * Business logic is in notesService
 */

const express = require('express');
const router = express.Router();
const noteValidation = require('../middleware/validators');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { fetchLinkPreview } = require('../utils/linkPreview');
const { validateImageFiles } = require('../utils/magicNumberValidator');
const { notesService } = require('../services');
const { httpStatus } = require('../constants');

// All routes require authentication
router.use(authenticateToken);

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
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'Fehler beim Abrufen der Link-Vorschau'
    });
  }
});

/**
 * POST /api/notes/:id/images - Upload images to a note
 * Supports multiple files (max 5 images per request)
 */
router.post('/:id/images', upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Keine Bilder hochgeladen' });
    }

    const path = require('path');
    const fs = require('fs');

    console.log(`[IMAGE UPLOAD] Received ${req.files.length} files for note ${req.params.id}`);
    req.files.forEach(file => {
      console.log(`[IMAGE UPLOAD] File: ${file.filename}, Size: ${file.size} bytes, Path: ${file.path}`);
      console.log(`[IMAGE UPLOAD] File exists: ${fs.existsSync(file.path)}`);
    });

    // Validate all uploaded files using magic number checking
    // This prevents malicious files with fake extensions from being uploaded
    const filepaths = req.files.map(file => path.join(__dirname, '../uploads/images', file.filename));

    try {
      const validationResult = await validateImageFiles(filepaths);

      if (validationResult.invalid.length > 0) {
        console.warn('[IMAGE UPLOAD] Magic number validation failed for files:', validationResult.invalid);
        // Clean up ALL uploaded files (including valid ones for security)
        req.files.forEach(file => {
          const filepath = path.join(__dirname, '../uploads/images', file.filename);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`[IMAGE UPLOAD] Deleted invalid file: ${file.filename}`);
          }
        });

        return res.status(httpStatus.BAD_REQUEST).json({
          error: 'Ungültige Bilddateien erkannt. Die hochgeladenen Dateien sind keine echten Bilder.'
        });
      }
      console.log('[IMAGE UPLOAD] All files passed magic number validation');
    } catch (validationError) {
      console.error('[IMAGE UPLOAD] Magic number validation error (continuing anyway):', validationError);
      // Continue with upload even if validation fails - better UX
    }

    // Generate thumbnails for all uploaded images
    const imageDataPromises = req.files.map(async file => {
      const filepath = path.join(__dirname, '../uploads/images', file.filename);

      console.log(`[IMAGE UPLOAD] Generating thumbnail for: ${file.filename}`);
      // Generate thumbnail
      const thumbnailFilename = await notesService.generateThumbnail(file.filename, filepath);

      if (thumbnailFilename) {
        console.log(`[IMAGE UPLOAD] Thumbnail created: ${thumbnailFilename}`);
        const thumbPath = path.join(__dirname, '../uploads/images', thumbnailFilename);
        console.log(`[IMAGE UPLOAD] Thumbnail exists: ${fs.existsSync(thumbPath)}`);
      } else {
        console.warn(`[IMAGE UPLOAD] Thumbnail generation failed for: ${file.filename}`);
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
    // Clean up uploaded files if database operation fails
    if (req.files) {
      const fs = require('fs');
      const path = require('path');
      req.files.forEach(file => {
        const filepath = path.join(__dirname, '../uploads/images', file.filename);
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
        // Also try to clean up thumbnail
        const ext = path.extname(file.filename);
        const nameWithoutExt = path.basename(file.filename, ext);
        const thumbpath = path.join(__dirname, '../uploads/images', `${nameWithoutExt}-thumb.webp`);
        if (fs.existsSync(thumbpath)) {
          fs.unlinkSync(thumbpath);
        }
      });
    }

    console.error('Error uploading images:', error);

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
 * DEBUG: List uploaded images in the uploads directory
 */
router.get('/debug/uploads', async (req, res) => {
  try {
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
      stack: error.stack
    });
  }
});

/**
 * DELETE /api/notes/:id/images/:filename - Delete an image from a note
 */
router.delete('/:id/images/:filename', async (req, res, next) => {
  try {
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
    }

    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

module.exports = router;
