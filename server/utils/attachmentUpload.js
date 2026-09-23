/**
 * Gemeinsame Upload-Pipeline fuer Bild- und Datei-Anhaenge (v1.15.0).
 *
 * Bis jetzt lebte diese Logik inline in der Session-Route (POST /api/notes/:id/
 * images|files) — die v1-API haette sie dupizieren muessen. Beide Router laufen
 * jetzt durch dieselben Middleware-Stuecke und Handler: Magic-Bytes-,
 * Aufloesungs- und Mengen-Regeln sind fuer Session-Cookie und API-Key identisch.
 *
 * Anforderungen an die Route: authenticateToken/authenticateApiKey (req.user),
 * noteValidation.getOne, requireEditableNote (req.ownedNote), demoPolicy.
 * Multer selbst wickelt wrapUpload ab — Fehler-Domain (Status-Codes, Texte)
 * ist hier, damit sie nicht pro Router auseinanderlaufen.
 */

const path = require('path');
const fs = require('fs');
const { validateImageFiles } = require('./magicNumberValidator');
const notesService = require('../services/notesService');
const { httpStatus } = require('../constants');
const { imagesDir, filesDir } = require('../config/paths');
const { assertStorageQuota } = require('./storageQuota');

const MAX_ATTACHMENTS_PER_NOTE = 25;

/**
 * Zugriff fuer Mitbearbeiter: eigene oder geteilte Notiz (req.ownedNote).
 * Wird fuer Uploads und Transkription verwendet — beides aendert Inhalt, den
 * auch geteilte Nutzer bearbeiten duerfen. Destruktives (Loeschen, Archiv,
 * Teilen) bleibt beim Besitzer. Bis v1.15.0 lokal in routes/notes.js.
 */
async function requireEditableNote(req, res, next) {
  try {
    req.ownedNote = await notesService.getEditableNoteById(req.params.id, req.user._id);
    next();
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    return next(error);
  }
}

/** Vor multer: Notiz schon am Limit — kein Temp-File anlegen, direkter 400er. */
function rejectIfAttachmentFull(kind) {
  const message = kind === 'images'
    ? 'Maximal 25 Bilder pro Notiz erlaubt'
    : 'Maximal 25 Dateianhänge pro Notiz erlaubt';
  return (req, res, next) => {
    if ((req.ownedNote?.[kind]?.length || 0) >= MAX_ATTACHMENTS_PER_NOTE) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: message });
    }
    next();
  };
}

/** Multer-Verpackung: Limit-/Filter-Fehler in ehrliche 400er uebersetzen. */
function wrapUpload(multerMiddleware, { sizeLabel, kindLabel }) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(httpStatus.BAD_REQUEST).json({
            error: `Datei zu groß. Maximale Dateigröße: ${sizeLabel}`
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(httpStatus.BAD_REQUEST).json({
            error: `Zu viele Dateien. Maximal 5 ${kindLabel} pro Upload.`
          });
        }
        if (err.message) {
          return res.status(httpStatus.BAD_REQUEST).json({ error: err.message });
        }
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Upload-Fehler' });
      }
      next();
    });
  };
}

/** POST-Body nach multer: Bilder validieren, verschieben, Thumbnails, addImages. */
async function handleImageUpload(req, res) {
  const tempFiles = []; // Track temp files for cleanup

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Keine Bilder hochgeladen' });
    }

    if ((req.ownedNote.images?.length || 0) + req.files.length > MAX_ATTACHMENTS_PER_NOTE) {
      await Promise.all(req.files.map(file => fs.promises.rm(file.path, { force: true })));
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Maximal 25 Bilder pro Notiz erlaubt' });
    }

    // Files are currently in TEMP directory (security measure)
    const tempFilePaths = req.files.map(file => file.path);
    tempFiles.push(...tempFilePaths);

    // Validate files in temp before moving anything into the served directory.
    const validationResult = await validateImageFiles(req.files.map(file => ({
      filepath: file.path,
      mimetype: file.mimetype
    })));

    if (validationResult.invalid.length > 0) {
      await Promise.all(tempFilePaths.map(filepath => fs.promises.rm(filepath, { force: true })));

      return res.status(httpStatus.BAD_REQUEST).json({
        error: 'Ungültige Bilddateien erkannt. Die hochgeladenen Dateien sind keine echten Bilder.'
      });
    }

    await notesService.validateImageDimensions(tempFilePaths);

    // Quota (v1.16.0): nach allen Validierungen, vor dem ersten Verschieben —
    // ein abgelehnter Upload hinterlässt keine Datei. Die Multiplikator-Summe
    // (Größe × Dateien) kann das Budget überschreiten, obwohl jede einzelne
    // Datei unter dem Multer-Limit bleibt.
    // Geprüft wird das Konto des NOTIZ-OWNERS (Review v1.16.0): Die Bytes
    // landen in dessen images[] und zählen in dessen getStorageUsage — gegen
    // den Uploader zu prüfen würde geteilte Notizen zum Quota-Bypass machen
    // (Kollaborator mit leerem Konto füllt das Volume des Owners).
    await assertStorageQuota(
      req.ownedNote.userId,
      req.files.reduce((sum, file) => sum + (file.size || 0), 0)
    );

    // Process sequentially so cleanup cannot race unfinished thumbnail jobs.
    const imageData = [];
    for (const file of req.files) {
      const tempPath = file.path;
      const finalPath = path.join(imagesDir(), file.filename);

      await fs.promises.rename(tempPath, finalPath);
      // v1.17.0: EXIF/GPS vom ausgelieferten Original streifen, BEVOR das
      // Thumbnail daraus gebaut wird — beide lesen danach denselben
      // bereinigten Stand, und die gespeicherte Größe ist die echte.
      const strippedSize = await notesService.stripImageMetadata(finalPath);
      const thumbnailFilename = await notesService.generateThumbnail(file.filename, finalPath);

      imageData.push({
        url: `/uploads/images/${file.filename}`,
        filename: file.filename,
        thumbnailUrl: thumbnailFilename ? `/uploads/images/${thumbnailFilename}` : '',
        thumbnailFilename: thumbnailFilename,
        size: strippedSize ?? file.size,
        uploadedAt: new Date()
      });
    }

    const note = await notesService.addImages(req.params.id, req.user._id, imageData);
    res.json(note);
  } catch (error) {
    console.error('[IMAGE UPLOAD] ✗ Error during upload:', error);

    // Clean up: Delete files from temp directory (if still there)
    tempFiles.forEach(filepath => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });

    // Clean up: Delete files from final directory and thumbnails (if already moved)
    if (req.files) {
      req.files.forEach(file => {
        const finalPath = path.join(imagesDir(), file.filename);
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }

        // Also delete thumbnail if it exists
        const ext = path.extname(file.filename);
        const nameWithoutExt = path.basename(file.filename, ext);
        const thumbpath = path.join(imagesDir(), `${nameWithoutExt}-thumb.webp`);
        if (fs.existsSync(thumbpath)) {
          fs.unlinkSync(thumbpath);
        }
      });
    }

    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }

    if (error.statusCode) {
      // Fehler-Code (z. B. STORAGE_QUOTA_EXCEEDED) mitreichen — der v1-Envelope
      // übernimmt ihn via Spread in success:false-Antworten.
      return res.status(error.statusCode).json({ ...(error.code ? { code: error.code } : {}), error: error.message });
    }

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'Fehler beim Hochladen der Bilder',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/** POST-Body nach multer: PDF-Magic-Bytes, verschieben, addFiles. */
async function handleFileUpload(req, res) {
  const tempFiles = [];

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Keine Dateien hochgeladen' });
    }

    if ((req.ownedNote.files?.length || 0) + req.files.length > MAX_ATTACHMENTS_PER_NOTE) {
      await Promise.all(req.files.map(file => fs.promises.rm(file.path, { force: true })));
      return res.status(httpStatus.BAD_REQUEST).json({ error: 'Maximal 25 Dateianhänge pro Notiz erlaubt' });
    }

    // Magic-Byte-Check: %PDF- am Dateianfang. Der Multer-Filter prueft nur
    // Client-Mime + Endung — ein Umbenanntes duerfe nie in files/ landen.
    for (const file of req.files) {
      const header = Buffer.alloc(5);
      const fd = fs.openSync(file.path, 'r');
      try {
        fs.readSync(fd, header, 0, 5, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (header.toString('latin1') !== '%PDF-') {
        await Promise.all(req.files.map(f => fs.promises.rm(f.path, { force: true })));
        return res.status(httpStatus.BAD_REQUEST).json({ error: 'Ungültige PDF-Dateien erkannt' });
      }
    }

    // Quota wie bei Bildern (v1.16.0): Validierungen durch, nichts verschoben.
    //Owner-Konto, siehe Bild-Upload.
    await assertStorageQuota(
      req.ownedNote.userId,
      req.files.reduce((sum, file) => sum + (file.size || 0), 0)
    );

    const fileData = [];
    for (const file of req.files) {
      const finalPath = path.join(filesDir(), file.filename);
      await fs.promises.rename(file.path, finalPath);
      fileData.push({
        url: `/uploads/files/${file.filename}`,
        filename: file.filename,
        originalName: path.basename(file.originalname || 'anhang.pdf').slice(0, 255),
        mimetype: 'application/pdf',
        size: file.size,
        uploadedAt: new Date()
      });
    }

    const note = await notesService.addFiles(req.params.id, req.user._id, fileData);
    res.json(note);
  } catch (error) {
    console.error('[FILE UPLOAD] ✗ Error during upload:', error);
    tempFiles.forEach(filepath => {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    });
    if (req.files) {
      req.files.forEach(file => {
        const finalPath = path.join(filesDir(), file.filename);
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      });
    }

    if (error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ error: 'Notiz nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ ...(error.code ? { code: error.code } : {}), error: error.message });
    }
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Serverfehler beim Upload' });
  }
}

module.exports = {
  requireEditableNote,
  rejectIfAttachmentFull,
  wrapUpload,
  handleImageUpload,
  handleFileUpload
};
