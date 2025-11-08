const express = require('express');
const router = express.Router();
const Note = require('../models/Note');

// GET /api/notes - Alle Notizen abrufen (mit optionaler Suche)
router.get('/', async (req, res, next) => {
  try {
    const { search, tag } = req.query;
    let query = {};

    // Volltextsuche in Titel und Inhalt
    if (search && search.trim() !== '') {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    // Nach Tag filtern
    if (tag && tag.trim() !== '') {
      query.tags = tag.toLowerCase();
    }

    const notes = await Note.find(query)
      .sort({ isPinned: -1, createdAt: -1 }); // Angepinnte Notizen zuerst

    res.json(notes);
  } catch (error) {
    next(error);
  }
});

// GET /api/notes/:id - Einzelne Notiz abrufen
router.get('/:id', async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id);

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
router.post('/', async (req, res, next) => {
  try {
    const { title, content, color, isPinned, tags } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Inhalt ist erforderlich' });
    }

    const newNote = new Note({
      title: title || '',
      content: content.trim(),
      color: color || '#ffffff',
      isPinned: isPinned || false,
      tags: tags || []
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
router.put('/:id', async (req, res, next) => {
  try {
    const { title, content, color, isPinned, tags } = req.body;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Inhalt ist erforderlich' });
    }

    const updatedNote = await Note.findByIdAndUpdate(
      req.params.id,
      {
        title: title || '',
        content: content.trim(),
        color: color,
        isPinned: isPinned,
        tags: tags
      },
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
router.delete('/:id', async (req, res, next) => {
  try {
    const deletedNote = await Note.findByIdAndDelete(req.params.id);

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
router.post('/:id/pin', async (req, res, next) => {
  try {
    const note = await Note.findById(req.params.id);

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

module.exports = router;
