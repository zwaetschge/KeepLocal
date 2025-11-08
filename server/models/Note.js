const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  title: {
    type: String,
    default: '',
    trim: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: [true, 'Inhalt ist erforderlich'],
    trim: true,
    maxlength: 10000
  },
  color: {
    type: String,
    default: '#ffffff',
    match: /^#[0-9A-Fa-f]{6}$/
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  images: [{
    url: String,
    filename: String,
    uploadedAt: Date
  }],
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Benutzer-ID ist erforderlich'],
    index: true
  }
}, {
  timestamps: true // Erstellt automatisch createdAt und updatedAt
});

// Index für schnellere Suche
noteSchema.index({ title: 'text', content: 'text' });
noteSchema.index({ userId: 1, isPinned: -1, createdAt: -1 }); // Compound index für Benutzer-Notizen
noteSchema.index({ userId: 1, tags: 1 }); // Index für Tag-Suche pro Benutzer

module.exports = mongoose.model('Note', noteSchema);
