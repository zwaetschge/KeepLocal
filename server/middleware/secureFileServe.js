const path = require('path');
const fs = require('fs');
const Note = require('../models/Note');

/**
 * Secure file serving middleware for uploaded images
 * Ensures users can only access files from notes they own or have access to
 */
const secureFileServe = async (req, res, next) => {
  try {
    // Extract filename from URL (e.g., /uploads/images/filename.jpg -> filename.jpg)
    const filename = req.params[0]; // Captures everything after /uploads/

    if (!filename) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    // Find note that contains this image
    const note = await Note.findOne({
      $or: [
        { 'images.filename': filename },
        { 'images.thumbnailFilename': filename }
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

    // User has access - serve the file
    const filepath = path.join(__dirname, '../uploads', filename);

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
