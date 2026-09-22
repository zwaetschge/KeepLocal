const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// v1.12.0 „Datei-Anhänge (PDF)": Server-seitige Kette aus Model, Service,
// Route (Magic Bytes) und Upload-Middleware. Die Auslieferung deckt
// secureFileServe.test.js ab, Backup/Janitor ihre eigenen Suiten.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

/** Mongoose-Query-Attrappe: .populate() kettenbar, await liefert das Dokument. */
function queryReturning(doc) {
  return {
    populate() { return this; },
    select() { return this; },
    then(onFulfilled, onRejected) { return Promise.resolve(doc).then(onFulfilled, onRejected); }
  };
}

function tempUploadsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-attachments-'));
}

test('addFiles pushes atomically under the cap, like addImages', async () => {
  const calls = [];
  const NoteMock = {
    findOneAndUpdate: (query, update) => {
      calls.push({ query, update });
      return queryReturning({ _id: 'n1', files: update.$push.files.$each });
    },
    exists: async () => false
  };
  const service = loadService(NoteMock);

  const entries = [{ url: '/uploads/files/a.pdf', filename: 'a.pdf', originalName: 'A.pdf' }];
  const note = await service.addFiles('n1', 'u1', entries);

  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].query.$expr.$lte), /\$size/, 'the size check runs inside the atomic update');
  assert.equal(calls[0].query.$expr.$lte[1], 25 - entries.length, 'the cap moves with the batch size');
  assert.deepEqual(calls[0].update.$push.files.$each, entries);
  assert.deepEqual(note.files, entries);
});

test('addFiles rejects batches outside 1..5 before touching the database', async () => {
  let touched = false;
  const NoteMock = {
    findOneAndUpdate: async () => { touched = true; return null; },
    exists: async () => { touched = true; return false; }
  };
  const service = loadService(NoteMock);

  await assert.rejects(service.addFiles('n1', 'u1', []), /1 bis 5 Dateien/);
  await assert.rejects(
    service.addFiles('n1', 'u1', new Array(6).fill({ filename: 'x.pdf' })),
    /1 bis 5 Dateien/
  );
  assert.equal(touched, false);
});

test('addFiles explains a missed conditional update: cap vs. not found', async () => {
  const NoteMock = {
    findOneAndUpdate: () => queryReturning(null),
    exists: async ({ _id }) => _id === 'mine'
  };
  const service = loadService(NoteMock);

  await assert.rejects(service.addFiles('mine', 'u1', [{ filename: 'a.pdf' }]), /25 Dateianhänge/);
  const notFound = await service.addFiles('other', 'u1', [{ filename: 'a.pdf' }]).catch(error => error);
  assert.equal(notFound.statusCode, 404);
});

test('removeFile pulls exactly the named attachment', async () => {
  let pull = null;
  const NoteMock = {
    findOneAndUpdate: (query, update) => {
      assert.equal(query['files.filename'], 'a.pdf');
      pull = update.$pull;
      return queryReturning({ _id: 'n1', files: [] });
    }
  };
  const service = loadService(NoteMock);

  await service.removeFile('n1', 'u1', 'a.pdf');
  assert.deepEqual(pull, { files: { filename: 'a.pdf' } });
});

test('purging a trashed note deletes its attachment files from disk', async () => {
  const uploadsRootDir = tempUploadsRoot();
  process.env.UPLOADS_DIR = uploadsRootDir;
  fs.mkdirSync(path.join(uploadsRootDir, 'files'), { recursive: true });
  const filename = 'purge-me.pdf';
  const filepath = path.join(uploadsRootDir, 'files', filename);
  fs.writeFileSync(filepath, '%PDF-1.4');

  const NoteMock = {
    findOneAndDelete: async () => ({ _id: 'n1', files: [{ filename }], images: [] }),
    updateMany: async () => ({ modifiedCount: 0 })
  };
  const service = loadService(NoteMock);

  try {
    await service.purgeNote('n1', 'u1');
    assert.equal(fs.existsSync(filepath), false, 'the attachment goes with the document');
  } finally {
    delete process.env.UPLOADS_DIR;
    fs.rmSync(uploadsRootDir, { recursive: true, force: true });
  }
});

test('the upload route only accepts real PDFs — filter, magic bytes, limits', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/notes.js'), 'utf8');
  // v1.15.0: Die Handler-Logik (Magic Bytes, Limits, Fehlermeldungen) wohnt in
  // der geteilten Pipeline server/utils/attachmentUpload.js — Session-Route
  // und v1-API benutzen dieselben Funktionen und driften nicht auseinander.
  const pipeline = fs.readFileSync(path.join(__dirname, '../utils/attachmentUpload.js'), 'utf8');
  const v1Routes = fs.readFileSync(path.join(__dirname, '../routes/v1/notes.js'), 'utf8');

  // Magic-Byte-Check: Der Multer-Filter vertraut Client-Angaben, die Route nicht.
  assert.match(pipeline, /'%PDF-'/, 'files are verified by their header, not by their mime type');
  assert.match(pipeline, /Ungültige PDF-Dateien erkannt/, 'a spoofed upload is rejected with a message');

  // Dasselbe Budget-Muster wie Bilder:Early-Check + Mengen-Check nach Multer.
  assert.match(pipeline, /Maximal 25 Dateianhänge pro Notiz erlaubt/);
  assert.match(pipeline, /Datei zu groß\. Maximale Dateigröße: \$\{sizeLabel\}/);
  assert.match(pipeline, /Zu viele Dateien\. Maximal 5 \$\{kindLabel\} pro Upload\./);
  // Die Route instanziiert wrapUpload mit den konkreten Labels:
  assert.match(routes, /wrapUpload\(uploadPdf\.array\('files', 5\), \{ sizeLabel: '25MB', kindLabel: 'Anhänge' \}\)/);
  assert.match(v1Routes, /wrapUpload\(uploadPdf\.array\('files', 5\), \{ sizeLabel: '25MB', kindLabel: 'Anhänge' \}\)/,
    'die v1-API hängt dieselbe Pipeline mit denselben Limits an');

  // Demo-Instanz: Uploads sind dort generell gesperrt.
  const postRoute = routes.slice(routes.indexOf("router.post('/:id/files'"));
  const deleteRoute = routes.slice(routes.indexOf("router.delete('/:id/files/:filename'"));
  assert.match(postRoute.slice(0, 200), /blockDemoUploads/);
  assert.match(deleteRoute.slice(0, 200), /blockDemoUploads/);

  // Anhänge landen in uploads/files und werden über filesDir() adressiert,
  // nie über einen hartkodierten Pfad (gleiche Lehre wie UPLOADS_DIR, Nr. 6).
  assert.match(pipeline, /\/uploads\/files\/\$\{file\.filename\}/);
  assert.match(pipeline, /path\.join\(filesDir\(\), file\.filename\)/);
});

test('the multer layer enforces PDF filter and size before the route runs', () => {
  const source = fs.readFileSync(path.join(__dirname, '../middleware/upload.js'), 'utf8');

  assert.match(source, /pdfFileFilter/, 'a dedicated filter exists');
  assert.match(source, /Nur PDF-Dateien sind als Anhang erlaubt/);
  assert.match(source, /uploadPdf = multer\(\{[\s\S]*?fileSize: 25 \* 1024 \* 1024[\s\S]*?\}\)/);
  assert.match(source, /filesUploadDir/, 'the files directory is created at boot');
});

test('the model carries the attachment fields and the serve index', () => {
  const source = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');

  assert.match(source, /originalName: \{\s*\n\s*type: String,\s*\n\s*trim: true,\s*\n\s*maxlength: 255/);
  assert.match(source, /noteSchema\.index\(\{ 'files\.filename': 1 \}\)/,
    'secureFileServe resolves /uploads/files/* over this index, not a COLLSCAN');
});
