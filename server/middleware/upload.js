/**
 * File Upload Middleware
 * Handles image and audio uploads using multer
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['audio/mpeg', '.mp3'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/ogg', '.ogg'],
  ['audio/m4a', '.m4a'],
  ['audio/mp4', '.m4a'],
  ['video/mp4', '.mp4'],
  ['audio/webm', '.webm'],
  ['video/webm', '.webm']
]);

const extensionForMimeType = (mimetype) => (
  MIME_EXTENSIONS.get(String(mimetype || '').toLowerCase()) || '.bin'
);

const createStoredFilename = (file) => (
  `${crypto.randomBytes(24).toString('hex')}${extensionForMimeType(file?.mimetype)}`
);

// Temporary upload directory for initial uploads (before validation)
const tempUploadDir = path.join(__dirname, '../uploads/temp');
try {
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    console.log('[Upload] Created temp upload directory:', tempUploadDir);
  }
} catch (error) {
  console.error('[Upload] CRITICAL: Failed to create temp upload directory:', error.message);
  console.error('[Upload] Image uploads will fail. Please create the directory manually:', tempUploadDir);
}

// Final upload directory (after validation)
const finalUploadDir = path.join(__dirname, '../uploads/images');
try {
  if (!fs.existsSync(finalUploadDir)) {
    fs.mkdirSync(finalUploadDir, { recursive: true });
    console.log('[Upload] Created final upload directory:', finalUploadDir);
  }
} catch (error) {
  console.error('[Upload] CRITICAL: Failed to create final upload directory:', error.message);
  console.error('[Upload] Image uploads will fail. Please create the directory manually:', finalUploadDir);
}

// Configure storage - uploads go to temp directory first
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempUploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, createStoredFilename(file));
  }
});

const isSafeStoredFilename = (filename) => (
  typeof filename === 'string' &&
  filename.length > 0 &&
  filename.length <= 255 &&
  filename !== '.' &&
  filename !== '..' &&
  path.basename(filename) === filename &&
  /^[a-zA-Z0-9_.-]+$/.test(filename)
);

// File filter - only allow images
const fileFilter = (req, file, cb) => {
  const allowedExtensions = new Set(['.jpeg', '.jpg', '.png', '.gif', '.webp']);
  const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const extname = allowedExtensions.has(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedMimeTypes.has(file.mimetype.toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Nur Bilder sind erlaubt (jpeg, jpg, png, gif, webp)'));
  }
};

// Audio filter - only allow audio files
const audioFileFilter = (req, file, cb) => {
  const allowedMimeTypes = new Set([
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/m4a',
    'audio/mp4', 'video/mp4', 'audio/webm', 'video/webm'
  ]);
  if (allowedMimeTypes.has(file.mimetype.toLowerCase())) {
    return cb(null, true);
  }
  cb(new Error('Ungültiges Audio-Format. Erlaubt: mp3, wav, ogg, m4a, webm'));
};

// Create multer instance for images
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: fileFilter
});

// Create separate multer instance for audio
const uploadAudio = multer({
  storage: storage, // Uses same temp directory
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB for audio files
  },
  fileFilter: audioFileFilter
});

// Export upload middleware and directory paths
module.exports = {
  upload,           // Image upload (default)
  uploadAudio,      // Audio upload (NEW)
  tempUploadDir,
  finalUploadDir,
  isSafeStoredFilename,
  createStoredFilename,
  extensionForMimeType
};
