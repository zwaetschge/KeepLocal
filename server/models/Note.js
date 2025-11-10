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
    default: '#ffffff', // Google Keep default white
    enum: [
      '#ffffff', // White
      '#f28b82', // Red
      '#fbbc04', // Orange
      '#fff475', // Yellow
      '#ccff90', // Green
      '#a7ffeb', // Teal
      '#cbf0f8', // Blue
      '#aecbfa', // Dark Blue
      '#d7aefb', // Purple
      '#fdcfe8', // Pink
      '#e6c9a8', // Brown
      '#e8eaed'  // Gray
    ]
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
  isTodoList: {
    type: Boolean,
    default: false
  },
  todoItems: [{
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    completed: {
      type: Boolean,
      default: false
    },
    order: {
      type: Number,
      default: 0
    }
  }],
  linkPreviews: [{
    url: {
      type: String,
      required: true
    },
    title: String,
    description: String,
    image: String,
    siteName: String,
    fetchedAt: Date
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
