const mongoose = require('mongoose');

/**
 * Short-lived cache for link previews.
 *
 * The editor asks for a preview every time a note containing a URL is opened, and
 * each request leaves the server towards the internet (DNS + TLS + up to 100 kB).
 * Caching by URL hash for 15 minutes removes most of that traffic and makes
 * reopening a note instant. MongoDB's TTL index does the cleanup.
 */
const linkPreviewCacheSchema = new mongoose.Schema({
  urlHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  url: {
    type: String,
    required: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  versionKey: false
});

linkPreviewCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });

module.exports = mongoose.model('LinkPreviewCache', linkPreviewCacheSchema);
