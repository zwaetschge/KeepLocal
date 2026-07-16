const path = require('path');
const fs = require('fs');
const Note = require('../models/Note');

// Resolve uploads directory once at startup
const uploadsDir = path.resolve(__dirname, '../uploads');

/**
 * Secure file serving middleware for uploaded images
 * Ensures users can only access files from notes they own or have access to
 */
const secureFileServe = async (req, res, next) => {
  try {
    // Extract full path after /uploads/ (e.g., "images/filename.jpg")
    const rawPath = req.params[0];

    if (!rawPath) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    // Only final note images are public through this route. Temp files and
    // encoded path traversal attempts must never be reachable.
    if (!/^images\/[^/\\]+$/.test(rawPath)) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    const basename = path.basename(rawPath);
    const filepath = path.resolve(uploadsDir, 'images', basename);
    const imagesDir = path.resolve(uploadsDir, 'images');
    if (!filepath.startsWith(imagesDir + path.sep)) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }

    // Find note that contains this image
    const note = await Note.findOne({
      $or: [
        { 'images.filename': basename },
        { 'images.thumbnailFilename': basename }
      ]
    });

    if (!note) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    // Check if user has access to this note
    const userId = req.user._id.toString();
    const hasAccess =
      note.userId.toString() === userId ||
      note.sharedWith.some(sharedUserId => sharedUserId.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Datei nicht auf dem Server gefunden' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(filepath);
  } catch (error) {
    console.error('[SecureFileServe] Error serving file:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Datei' });
  }
};

module.exports = secureFileServe;
