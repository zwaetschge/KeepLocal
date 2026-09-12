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
    default: '',
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
  isArchived: {
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
    thumbnailUrl: String,
    thumbnailFilename: String,
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
  },
  // Wer die Notiz zuletzt inhaltlich geändert hat — bei geteilten Notizen sonst
  // nicht nachvollziehbar (der Besitzer ist nicht unbedingt der Autor).
  lastEditedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sharedWith: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Papierkorb: weiches Löschen. `null` = aktiv, Datum = gelöscht am.
  // Ein partieller TTL-Index lässt MongoDB die Dokumente nach 30 Tagen selbst
  // entfernen; die Bilddateien räumt der Purge-Pfad bzw. der Start auf.
  deletedAt: {
    type: Date,
    default: null
  },
  // Manuelle Reihenfolge innerhalb eines Abschnitts (angeheftet / sonstige):
  // höher = weiter oben. 0 = nie manuell sortiert, dann entscheidet updatedAt.
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true // Erstellt automatisch createdAt und updatedAt
});

// Index für schnellere Suche - weighted text index over title, content and todo
// items. `default_language: 'none'` keeps the tokenizer neutral: with the
// previous default ('english') German words were not stemmed but English
// stopwords were dropped, and a title match ranked exactly like a body match.
// Note: MongoDB allows one text index per collection, so config/indexMigration.js
// drops the legacy unweighted index before mongoose creates this one.
noteSchema.index(
  { title: 'text', content: 'text', 'todoItems.text': 'text' },
  {
    name: 'note_text_search',
    weights: { title: 5, 'todoItems.text': 2, content: 1 },
    default_language: 'none'
  }
);
noteSchema.index({ userId: 1, isPinned: -1, isArchived: 1, createdAt: -1 }); // Compound index für Benutzer-Notizen
noteSchema.index({ userId: 1, isPinned: -1, isArchived: 1, updatedAt: -1 }); // list sort order (recency)
noteSchema.index({ userId: 1, tags: 1 }); // Index für Tag-Suche pro Benutzer
noteSchema.index({ sharedWith: 1 }); // Index für geteilte Notizen
// Bildauslieferung: middleware/secureFileServe.js sucht die Notiz zu jeder
// /uploads/images/*-Anfrage über genau diese beiden Array-Felder. Ohne Index
// war jeder Thumbnail ein COLLSCAN über die gesamte (instanzweite)
// notes-Collection — 30 Bildnotizen an der Wand bedeuteten 30-60 Vollscans pro
// Board-Rendering. Bewusst NICHT unique: ein fehlgeschlagener Unique-Build auf
// Bestandsdaten würde syncIndexes() rejecten und den Startup vor app.listen()
// töten (siehe UPGRADE_FIX_2026-09-12.md).
noteSchema.index({ 'images.filename': 1 });
noteSchema.index({ 'images.thumbnailFilename': 1 });
noteSchema.index({ userId: 1, isPinned: -1, isArchived: 1, order: -1, updatedAt: -1 }); // manuelle Reihenfolge
noteSchema.index(
  { deletedAt: 1 },
  {
    name: 'trash_ttl',
    // 31 Tage = Backstop. Endgültig aufräumen tut services/storageJanitor.js bei
    // 30 Tagen, denn MongoDBs TTL-Monitor löscht nur das Dokument — die
    // Bilddateien bleiben sonst für immer liegen. Der eine Tag Abstand lässt den
    // Janitor das Rennen gewinnen.
    expireAfterSeconds: 31 * 24 * 60 * 60,
    partialFilterExpression: { deletedAt: { $type: 'date' } }
  }
); // Papierkorb: automatische Endlöschung nach 30 Tagen (+1 Tag Backstop)

// Validation: Ensure either content or todo items exist
noteSchema.pre('save', function(next) {
  if (this.isTodoList) {
    // For todo lists, ensure at least one non-empty todo item exists
    const hasValidTodoItems = this.todoItems &&
      this.todoItems.length > 0 &&
      this.todoItems.some(item => item.text && item.text.trim());

    if (!hasValidTodoItems) {
      return next(new Error('Todo-Liste muss mindestens ein Element enthalten'));
    }
  } else {
    // For regular notes, ensure content is not empty
    if (!this.content || this.content.trim() === '') {
      return next(new Error('Inhalt ist erforderlich'));
    }
  }
  next();
});

module.exports = mongoose.model('Note', noteSchema);
