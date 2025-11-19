/**
 * File Upload Middleware
 * Handles image and audio uploads using multer
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Temporary upload directory for initial uploads (before validation)
const tempUploadDir = path.join(__dirname, '../uploads/temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Final upload directory (after validation)
const finalUploadDir = path.join(__dirname, '../uploads/images');
if (!fs.existsSync(finalUploadDir)) {
  fs.mkdirSync(finalUploadDir, { recursive: true });
}

// Configure storage - uploads go to temp directory first
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempUploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp-randomstring-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    // Sanitize filename
    const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, sanitizedName + '-' + uniqueSuffix + ext);
  }
});

// File filter - only allow images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Nur Bilder sind erlaubt (jpeg, jpg, png, gif, webp)'));
  }
};

// Audio filter - only allow audio files
const audioFileFilter = (req, file, cb) => {
  const allowedTypes = /audio\/mpeg|audio\/wav|audio\/ogg|audio\/m4a|audio\/mp4|video\/mp4|audio\/webm/;
  // Simple mime-type check (magic number validation for audio is more complex)
  if (allowedTypes.test(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error('Ungültiges Audio-Format. Erlaubt: mp3, wav, ogg, m4a, webm'));
};

// Create multer instance for images
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
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
  finalUploadDir
};
