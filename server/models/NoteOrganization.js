const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    noteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Note',
      required: true,
    },
    color: String,
    isPinned: Boolean,
    isArchived: Boolean,
    tags: { type: [String], default: undefined },
  },
  { timestamps: true },
);
schema.index({ userId: 1, noteId: 1 }, { unique: true });
module.exports = mongoose.model('NoteOrganization', schema);
