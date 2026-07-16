/**
 * Magic Number Validator
 * Validates file types by checking magic numbers (file signatures) in the file header
 * Prevents uploading of malicious files with fake extensions
 */

const fs = require('fs').promises;

/**
 * Known magic numbers for image file formats
 * Each entry contains the byte signature and offset where it appears
 */
const IMAGE_SIGNATURES = {
  jpeg: [
    { signature: [0xFF, 0xD8, 0xFF], offset: 0 }
  ],
  png: [
    { signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 }
  ],
  gif: [
    { signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], offset: 0 }, // GIF87a
    { signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], offset: 0 }  // GIF89a
  ],
  webp: [
    { signature: [0x52, 0x49, 0x46, 0x46], offset: 0, extraCheck: { signature: [0x57, 0x45, 0x42, 0x50], offset: 8 } } // RIFF + WEBP
  ],
  bmp: [
    { signature: [0x42, 0x4D], offset: 0 }
  ]
};

const AUDIO_SIGNATURES = [
  buffer => matchesSignature(buffer, [0x49, 0x44, 0x33]), // MP3 with ID3
  buffer => buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0, // MP3 frame
  buffer => matchesSignature(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    matchesSignature(buffer, [0x57, 0x41, 0x56, 0x45], 8), // WAV
  buffer => matchesSignature(buffer, [0x4f, 0x67, 0x67, 0x53]), // Ogg
  buffer => matchesSignature(buffer, [0x1a, 0x45, 0xdf, 0xa3]), // WebM/Matroska
  buffer => matchesSignature(buffer, [0x66, 0x74, 0x79, 0x70], 4) // M4A/MP4
];

const IMAGE_MIME_FORMATS = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/bmp', 'bmp']
]);

/**
 * Check if a buffer matches a signature at a given offset
 * @param {Buffer} buffer - File buffer
 * @param {Array} signature - Expected byte signature
 * @param {number} offset - Offset in buffer to check
 * @returns {boolean} True if signature matches
 */
function matchesSignature(buffer, signature, offset = 0) {
  if (buffer.length < offset + signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i++) {
    if (buffer[offset + i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Validate if a file is a legitimate image by checking magic numbers
 * @param {string} filepath - Path to the uploaded file
 * @returns {Promise<boolean>} True if file is a valid image
 */
async function detectImageFormat(filepath) {
  let fileHandle;
  try {
    // Read first 16 bytes of the file (enough for all image signatures)
    fileHandle = await fs.open(filepath, 'r');
    const buffer = Buffer.alloc(16);
    await fileHandle.read(buffer, 0, 16, 0);

    // Check against all known image signatures
    for (const [format, signatures] of Object.entries(IMAGE_SIGNATURES)) {
      for (const sig of signatures) {
        const mainMatch = matchesSignature(buffer, sig.signature, sig.offset);

        // For WebP, also check the extra signature
        if (mainMatch && sig.extraCheck) {
          const extraMatch = matchesSignature(buffer, sig.extraCheck.signature, sig.extraCheck.offset);
          if (extraMatch) {
            return format;
          }
        } else if (mainMatch) {
          return format;
        }
      }
    }

    // No matching signature found
    return null;
  } catch (error) {
    console.error('Error validating file magic number:', error);
    return null;
  } finally {
    await fileHandle?.close().catch(() => {});
  }
}

async function validateImageFile(filepath, expectedMimeType = null) {
  const detectedFormat = await detectImageFormat(filepath);
  if (!detectedFormat) return false;
  if (!expectedMimeType) return true;
  return IMAGE_MIME_FORMATS.get(String(expectedMimeType).toLowerCase()) === detectedFormat;
}

async function validateAudioFile(filepath) {
  let fileHandle;
  try {
    fileHandle = await fs.open(filepath, 'r');
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    return AUDIO_SIGNATURES.some(matches => matches(header));
  } catch (error) {
    console.error('Error validating audio magic number:', error.message);
    return false;
  } finally {
    await fileHandle?.close().catch(() => {});
  }
}

/**
 * Validate multiple image files
 * @param {Array<string>} filepaths - Array of file paths
 * @returns {Promise<Object>} Object with valid and invalid file paths
 */
async function validateImageFiles(files) {
  const results = await Promise.all(
    files.map(async (file) => {
      const filepath = typeof file === 'string' ? file : file.filepath;
      const mimetype = typeof file === 'string' ? null : file.mimetype;
      return {
        filepath,
        isValid: await validateImageFile(filepath, mimetype)
      };
    })
  );

  return {
    valid: results.filter(r => r.isValid).map(r => r.filepath),
    invalid: results.filter(r => !r.isValid).map(r => r.filepath)
  };
}

module.exports = {
  validateImageFile,
  validateImageFiles,
  validateAudioFile,
  detectImageFormat,
  IMAGE_SIGNATURES, // Export for testing
};
