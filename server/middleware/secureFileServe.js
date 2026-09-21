const path = require('path');
const fs = require('fs');
const Note = require('../models/Note');
const { uploadsRoot, imagesDir, filesDir } = require('../config/paths');

// Uploads-Wurzel aus config/paths (UPLOADS_DIR), nicht hartkodiert: sonst liest
// dieser Pfad ein anderes Verzeichnis als Backup/Healthcheck.
const uploadsDir = uploadsRoot();

/** RFC 5987-kodierter Download-Name (attachment/filename*), 255-Zeichen-Limit des Modells. */
function contentDispositionFor(originalName) {
  const safe = String(originalName || 'anhang.pdf').slice(0, 255).replace(/[\r\n"]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="anhang.pdf"; filename*=UTF-8''${encoded}`;
}

/**
 * Secure file serving middleware for uploaded images and file attachments.
 * Ensures users can only access files from notes they own or have access to.
 */
const secureFileServe = async (req, res, next) => {
  try {
    // Extract full path after /uploads/ (e.g., "images/filename.jpg")
    const rawPath = req.params[0];

    if (!rawPath) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    // Only final note files are public through this route. Temp files and
    // encoded path traversal attempts must never be reachable.
    const isImage = /^images\/[^/\\]+$/.test(rawPath);
    const isAttachment = /^files\/[^/\\]+$/.test(rawPath);
    if (!isImage && !isAttachment) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    const kind = isImage ? 'images' : 'files';
    const baseDir = isImage ? path.resolve(imagesDir()) : path.resolve(filesDir());
    const basename = path.basename(rawPath);
    const filepath = path.resolve(baseDir, basename);
    if (!filepath.startsWith(baseDir + path.sep)) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }

    // Find note that contains this file
    const note = isImage
      ? await Note.findOne({
        $or: [
          { 'images.filename': basename },
          { 'images.thumbnailFilename': basename }
        ]
      })
      : await Note.findOne({ 'files.filename': basename });

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
    if (isAttachment) {
      // Anhänge (PDF) immer als Download ausliefern: kein Inline-Rendern, kein
      // Mime-Sniffing — der Typ steht fest, der Name ist der ursprüngliche.
      const meta = (note.files || []).find(file => file.filename === basename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDispositionFor(meta?.originalName));
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.sendFile(filepath);
  } catch (error) {
    console.error('[SecureFileServe] Error serving file:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Datei' });
  }
};

module.exports = secureFileServe;
