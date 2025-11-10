const express = require('express');
const router = express.Router();
const Note = require('../models/Note');
const noteValidation = require('../middleware/validators');
const { authenticateToken } = require('../middleware/auth');
const { fetchLinkPreview } = require('../utils/linkPreview');

// Alle Routen erfordern Authentifizierung
router.use(authenticateToken);

// Escape regex special characters to prevent NoSQL injection
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/notes - Alle Notizen abrufen (mit optionaler Suche und Pagination)
router.get('/', noteValidation.search, async (req, res, next) => {
  try {
    const { search, tag, page = 1, limit = 50 } = req.query;

    // Query nur für Notizen des aktuellen Benutzers
    let query = { userId: req.user._id };

    // Volltextsuche in Titel, Inhalt und Todo-Items
    if (search && search.trim() !== '') {
      const escapedSearch = escapeRegex(search.trim());
      query.$or = [
        { title: { $regex: escapedSearch, $options: 'i' } },
        { content: { $regex: escapedSearch, $options: 'i' } },
        { 'todoItems.text': { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    // Nach Tag filtern
    if (tag && tag.trim() !== '') {
      query.tags = tag.toLowerCase();
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Note.countDocuments(query);

    const notes = await Note.find(query)
      .sort({ isPinned: -1, createdAt: -1 }) // Angepinnte Notizen zuerst
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      notes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/notes/:id - Einzelne Notiz abrufen
router.get('/:id', noteValidation.getOne, async (req, res, next) => {
  try {
    const note = await Note.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!note) {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }

    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

// POST /api/notes - Neue Notiz erstellen
router.post('/', noteValidation.create, async (req, res, next) => {
  try {
    console.log('=== POST /api/notes REQUEST BODY ===');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('===================================');

    const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews } = req.body;

    const newNote = new Note({
      title: title || '',
      content: isTodoList ? '' : (content?.trim() || ''),
      color: color || '#ffffff',
      isPinned: isPinned || false,
      tags: tags || [],
      isTodoList: isTodoList || false,
      todoItems: isTodoList ? (todoItems || []) : [],
      linkPreviews: linkPreviews || [],
      userId: req.user._id // Benutzer-ID hinzufügen
    });

    const savedNote = await newNote.save();
    res.status(201).json(savedNote);
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// PUT /api/notes/:id - Notiz aktualisieren
router.put('/:id', noteValidation.update, async (req, res, next) => {
  try {
    const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews } = req.body;

    // Build update object
    const updateData = {
      title: title || '',
      content: isTodoList ? '' : (content?.trim() || ''),
      color: color,
      isPinned: isPinned,
      tags: tags,
      isTodoList: isTodoList || false,
      todoItems: isTodoList ? (todoItems || []) : [],
      linkPreviews: linkPreviews || []
    };

    // Nur Notizen des eigenen Benutzers aktualisieren
    const updatedNote = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedNote) {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }

    res.json(updatedNote);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// DELETE /api/notes/:id - Notiz löschen
router.delete('/:id', noteValidation.delete, async (req, res, next) => {
  try {
    // Nur eigene Notizen löschen
    const deletedNote = await Note.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!deletedNote) {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }

    res.json({ message: 'Notiz gelöscht', note: deletedNote });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

// POST /api/notes/:id/pin - Notiz anheften/abheften
router.post('/:id/pin', noteValidation.pin, async (req, res, next) => {
  try {
    // Nur eigene Notizen anheften
    const note = await Note.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!note) {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }

    note.isPinned = !note.isPinned;
    await note.save();

    res.json(note);
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ error: 'Notiz nicht gefunden' });
    }
    next(error);
  }
});

// POST /api/notes/link-preview - Fetch link preview metadata
router.post('/link-preview', async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL ist erforderlich' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Ungültige URL' });
    }

    // Fetch link preview
    const preview = await fetchLinkPreview(url);
    preview.fetchedAt = new Date();

    res.json(preview);
  } catch (error) {
    console.error('Link preview error:', error);
    res.status(500).json({
      error: 'Link-Vorschau konnte nicht abgerufen werden',
      message: error.message
    });
  }
});

module.exports = router;
