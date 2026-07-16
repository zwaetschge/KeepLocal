const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateAudioFile, validateImageFile } = require('../utils/magicNumberValidator');
const { createStoredFilename, extensionForMimeType } = require('../middleware/upload');

async function withTempHeader(bytes, callback) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'keeplocal-audio-'));
  const filepath = path.join(directory, 'upload.bin');
  await fs.promises.writeFile(filepath, Buffer.from(bytes));
  try {
    return await callback(filepath);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

test('audio validation accepts supported file signatures', async () => {
  const headers = [
    [0x49, 0x44, 0x33, 0x04],
    [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
    [0x4f, 0x67, 0x67, 0x53],
    [0x1a, 0x45, 0xdf, 0xa3],
    [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]
  ];

  for (const header of headers) {
    await withTempHeader(header, async filepath => {
      assert.equal(await validateAudioFile(filepath), true);
    });
  }
});

test('audio validation rejects a spoofed arbitrary upload', async () => {
  await withTempHeader(Buffer.from('<script>alert(1)</script>'), async filepath => {
    assert.equal(await validateAudioFile(filepath), false);
  });
});

test('image count is enforced in the database update, not only before upload', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../services/notesService.js'), 'utf8');
  assert.match(source, /\$expr/);
  assert.match(source, /\$size/);
  assert.match(source, /MAX_IMAGES_PER_NOTE/);
});

test('stored filenames reveal no original name and use a bounded MIME-derived extension', () => {
  const filename = createStoredFilename({
    originalname: `private-title.${'x'.repeat(10000)}`,
    mimetype: 'audio/webm'
  });

  assert.match(filename, /^[a-f0-9]{48}\.webm$/);
  assert.doesNotMatch(filename, /private|title|x{10}/);
  assert.equal(extensionForMimeType('image/jpeg'), '.jpg');
  assert.equal(extensionForMimeType('application/octet-stream'), '.bin');
});

test('image signatures must match the declared MIME type', async () => {
  const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  await withTempHeader(pngHeader, async filepath => {
    assert.equal(await validateImageFile(filepath, 'image/png'), true);
    assert.equal(await validateImageFile(filepath, 'image/jpeg'), false);
  });
});
