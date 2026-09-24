const mongoose = require('mongoose');

/**
 * Chunk-Idempotenz für den Markdown-Import (v1.18.0).
 *
 * Der Web-Client importiert größere Ordner als Sequenz von Chunks
 * (POST /api/notes/import/markdown). Schlug ein Chunk mittendrin fehl und der
 * Nutzer versuchte es erneut, duplizierte der Retry jede Notiz der bereits
 * gelandeten Chunks. Jeder Import-Lauf trägt jetzt eine client-generierte
 * importId; der Server merkt sich pro Lauf die angewandten Chunk-Indizes und
 * überspringt sie beim Wiederholen. MongoDBs TTL-Index räumt abgelaufene
 * Läufe nach 6 Stunden weg — das Resume-Fenster.
 */
const importRunSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  importId: {
    type: String,
    required: true,
    minlength: 8,
    maxlength: 64
  },
  appliedChunks: {
    type: [Number],
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '6h'
  }
}, { collection: 'import_runs' });

// Ein Dokument pro (userId, importId) — die $addToSet-UPSERTs der Chunks
// brauchen die Eindeutigkeit, sonst entstünden parallele Zähler-Dokumente.
importRunSchema.index({ userId: 1, importId: 1 }, { unique: true });

module.exports = mongoose.model('ImportRun', importRunSchema);
