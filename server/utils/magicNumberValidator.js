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
async function validateImageFile(filepath) {
  try {
    // Read first 16 bytes of the file (enough for all image signatures)
    const fileHandle = await fs.open(filepath, 'r');
    const buffer = Buffer.alloc(16);
    await fileHandle.read(buffer, 0, 16, 0);
    await fileHandle.close();

    // Check against all known image signatures
    for (const [format, signatures] of Object.entries(IMAGE_SIGNATURES)) {
      for (const sig of signatures) {
        const mainMatch = matchesSignature(buffer, sig.signature, sig.offset);

        // For WebP, also check the extra signature
        if (mainMatch && sig.extraCheck) {
          const extraMatch = matchesSignature(buffer, sig.extraCheck.signature, sig.extraCheck.offset);
          if (extraMatch) {
            return true;
          }
        } else if (mainMatch) {
          return true;
        }
      }
    }

    // No matching signature found
    return false;
  } catch (error) {
    console.error('Error validating file magic number:', error);
    return false;
  }
}

/**
 * Validate multiple image files
 * @param {Array<string>} filepaths - Array of file paths
 * @returns {Promise<Object>} Object with valid and invalid file paths
 */
async function validateImageFiles(filepaths) {
  const results = await Promise.all(
    filepaths.map(async (filepath) => ({
      filepath,
      isValid: await validateImageFile(filepath)
    }))
  );

  return {
    valid: results.filter(r => r.isValid).map(r => r.filepath),
    invalid: results.filter(r => !r.isValid).map(r => r.filepath)
  };
}

module.exports = {
  validateImageFile,
  validateImageFiles,
  IMAGE_SIGNATURES, // Export for testing
};
