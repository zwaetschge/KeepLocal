/**
 * Notes Routes
 * HTTP endpoints for note operations
 * Business logic is in notesService
 */

const express = require('express');
const router = express.Router();
const noteValidation = require('../middleware/validators');
const { authenticateToken } = require('../middleware/auth');
const { fetchLinkPreview } = require('../utils/linkPreview');
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

module.exports = router;
