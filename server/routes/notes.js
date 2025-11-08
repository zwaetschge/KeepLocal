const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// In-Memory Speicher für Notizen (kann später durch Datenbank ersetzt werden)
let notes = [
  {
    id: uuidv4(),
    title: 'Willkommen bei KeepLocal!',
    content: 'Dies ist Ihre erste Notiz. Sie können sie bearbeiten oder löschen.',
    color: '#fff475',
    createdAt: new Date().toISOString()
  },
  {
    id: uuidv4(),
    title: 'Features',
    content: '✅ Notizen erstellen\n✅ Notizen bearbeiten\n✅ Notizen löschen\n✅ Farben wählen',
    color: '#ccff90',
    createdAt: new Date().toISOString()
  }
];

// GET /api/notes - Alle Notizen abrufen
router.get('/', (req, res) => {
  res.json(notes);
});

// GET /api/notes/:id - Einzelne Notiz abrufen
router.get('/:id', (req, res) => {
  const note = notes.find(n => n.id === req.params.id);

  if (!note) {
    return res.status(404).json({ error: 'Notiz nicht gefunden' });
  }

  res.json(note);
});

// POST /api/notes - Neue Notiz erstellen
router.post('/', (req, res) => {
  const { title, content, color } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Inhalt ist erforderlich' });
  }

  const newNote = {
    id: uuidv4(),
    title: title || '',
    content: content,
    color: color || '#ffffff',
    createdAt: new Date().toISOString()
  };

  notes.unshift(newNote); // Neue Notiz am Anfang hinzufügen
  res.status(201).json(newNote);
});

// PUT /api/notes/:id - Notiz aktualisieren
router.put('/:id', (req, res) => {
  const { title, content, color } = req.body;
  const noteIndex = notes.findIndex(n => n.id === req.params.id);

  if (noteIndex === -1) {
    return res.status(404).json({ error: 'Notiz nicht gefunden' });
  }

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Inhalt ist erforderlich' });
  }

  notes[noteIndex] = {
    ...notes[noteIndex],
    title: title || '',
    content: content,
    color: color || notes[noteIndex].color,
    updatedAt: new Date().toISOString()
  };

  res.json(notes[noteIndex]);
});

// DELETE /api/notes/:id - Notiz löschen
router.delete('/:id', (req, res) => {
  const noteIndex = notes.findIndex(n => n.id === req.params.id);

  if (noteIndex === -1) {
    return res.status(404).json({ error: 'Notiz nicht gefunden' });
  }

  const deletedNote = notes.splice(noteIndex, 1)[0];
  res.json({ message: 'Notiz gelöscht', note: deletedNote });
});

module.exports = router;
