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

    // SECURITY: Path traversal protection - resolve the full path and ensure
    // it stays within the uploads directory
    const filepath = path.resolve(uploadsDir, rawPath);
    if (!filepath.startsWith(uploadsDir + path.sep)) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }

    // Extract just the basename for DB lookup since images are stored
    // with bare filenames (e.g., "filename.jpg"), not paths like "images/filename.jpg"
    const basename = path.basename(rawPath);

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

    // Send file
    res.sendFile(filepath);
  } catch (error) {
    console.error('[SecureFileServe] Error serving file:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Datei' });
  }
};

module.exports = secureFileServe;
