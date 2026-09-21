const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// v1.12.0 „Datei-Anhänge (PDF)": Verdrahtung im Modal, API-Client und i18n.
// Die Server-Kette deckt server/tests/fileAttachments.test.js ab.

// Gleiche Lehre wie BUG_REPORT_2026-09-10 #6 bei Bildern: Ein Anhang-Upload
// ändert updatedAt serverseitig — ohne Refresh der Baseline ist die nächste
// Speicherung ein falscher 409 gegen den eigenen Upload.
test('attachment mutations refresh the optimistic-locking baseline', () => {
  const source = read('components', 'NoteModal.jsx');
  const upload = source.split('notesAPI.uploadFiles(')[1].split('};')[0];

  assert.match(upload, /setNoteFiles\(updatedNote\.files/, 'the stored list follows the server answer');
  assert.match(
    upload,
    /baseUpdatedAtRef\.current = updatedNote\.updatedAt/,
    'the upload bumps the optimistic-locking baseline'
  );

  const remove = source.split('notesAPI.deleteFile(')[1].split('};')[0];
  assert.match(remove, /baseUpdatedAtRef\.current = updatedNote\.updatedAt/);
});

test('the attachment picker stays inside the per-note budget', () => {
  const source = read('components', 'NoteModal.jsx');
  const select = source.split('const handlePdfSelect')[1].split('};')[0];

  assert.match(select, /application\/pdf/, 'only PDFs are accepted');
  assert.match(
    select,
    /Math\.max\(0, Math\.min\(5, 25 - noteFiles\.length - newPdfFiles\.length\)\)/,
    'the per-request limit shrinks with the remaining per-note budget'
  );
});

test('attachments render as downloads with their original name, never inline', () => {
  const source = read('components', 'NoteModal.jsx');

  assert.match(source, /href=\{file\.url\}\s*\n\s*download=\{file\.originalName \|\| 'anhang\.pdf'\}/,
    'the download attribute restores the original filename');
  assert.doesNotMatch(source, /<iframe[^>]*file\.url/, 'PDFs are never embedded inline');
  assert.match(source, /accept="application\/pdf,\.pdf"\s*\n\s*multiple[\s\S]*?id="pdf-upload-input"/);
  assert.match(source, /htmlFor="pdf-upload-input"/, 'the paperclip button opens the picker via label');
});

test('the API client speaks the attachment endpoints', () => {
  const source = read('services', 'api', 'notesAPI.js');

  assert.match(source, /uploadFiles: async \(id, files\)/);
  assert.match(source, /formData\.append\('files', file\)/);
  assert.match(source, /BY_ID\(id\)\}\/files`/, 'uploads POST to /:id/files');
  assert.match(source, /Datei-Upload fehlgeschlagen/);
  assert.match(source, /deleteFile: \(id, filename\)/);
  assert.match(source, /files\/\$\{encodeURIComponent\(filename\)\}/, 'the stored name is URL-encoded on delete');
});

test('both languages carry every attachment string', () => {
  const keys = [
    'selectFiles', 'uploadingFiles', 'uploadFilesCount', 'downloadFile',
    'deleteFile', 'removeFile', 'errorUploadingFiles', 'errorDeletingFile'
  ];
  for (const file of ['de.js', 'en.js']) {
    const translations = read('translations', file);
    for (const key of keys) {
      assert.match(translations, new RegExp(`${key}: '`), `${file} is missing ${key}`);
    }
  }
});
