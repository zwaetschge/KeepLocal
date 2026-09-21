const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 5): der partielle TTL-Index auf `deletedAt`
// laesst MongoDB das DOKUMENT loeschen — die Bilddateien bleiben fuer immer
// liegen, obwohl die UI "nach 30 Tagen endgueltig entfernt" verspricht. Im
// All-in-One-Image teilen sich mongod und die Uploads einen Datentraeger.

const janitorPath = require.resolve('../services/storageJanitor');
const noteModelPath = require.resolve('../models/Note');
const notesServicePath = require.resolve('../services/notesService');
const loggerPath = require.resolve('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

function loadJanitor({ notes = [], failFind = false } = {}) {
  const deletedImageCalls = [];
  const deletedFileCalls = [];
  const deleteManyCalls = [];

  const chain = (rows) => ({ select: () => ({ lean: async () => rows }) });
  const NoteMock = {
    find: (query) => {
      if (failFind) throw new Error('mongo down');
      if (query?.deletedAt?.$lte) {
        const cutoff = query.deletedAt.$lte.getTime();
        return chain(notes.filter((note) => note.deletedAt && note.deletedAt.getTime() <= cutoff));
      }
      return chain(notes);
    },
    deleteMany: async (query) => {
      deleteManyCalls.push(query);
      const ids = query._id.$in.map(String);
      return { deletedCount: notes.filter((note) => ids.includes(String(note._id))).length };
    }
  };

  for (const modulePath of [janitorPath, notesServicePath]) delete require.cache[modulePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[notesServicePath] = {
    id: notesServicePath, filename: notesServicePath, loaded: true,
    exports: {
      deleteNoteImages: async (note) => { deletedImageCalls.push(String(note._id)); },
      deleteNoteFiles: async (note) => { deletedFileCalls.push(String(note._id)); }
    }
  };
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: { info() {}, warn() {}, error() {}, debug() {} }
  };

  return { janitor: require(janitorPath), deletedImageCalls, deletedFileCalls, deleteManyCalls };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-janitor-'));
}

function writeFile(dir, name, ageMs, size = 8) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'x'.repeat(size));
  const past = new Date(Date.now() - ageMs);
  fs.utimesSync(filePath, past, past);
  return filePath;
}

test('expired trash is purged: files first, then documents', async () => {
  const old = {
    _id: 'old', deletedAt: new Date(now - 40 * DAY_MS),
    images: [{ filename: 'a.png', thumbnailFilename: 'a-thumb.webp' }],
    files: [{ filename: 'b.pdf' }, { filename: 'c.pdf' }]
  };
  const young = { _id: 'young', deletedAt: new Date(now - 5 * DAY_MS), images: [], files: [] };
  const { janitor, deletedImageCalls, deletedFileCalls, deleteManyCalls } = loadJanitor({ notes: [old, young] });

  const result = await janitor.purgeExpiredTrash({ now, retentionDays: 30 });

  assert.equal(result.notes, 1, 'only the expired note is removed');
  assert.equal(result.files, 4, 'original, thumbnail and both attachments are counted');
  assert.deepEqual(deletedImageCalls, ['old'], 'the files go before the document');
  assert.deepEqual(deletedFileCalls, ['old'], 'attachments are cleaned with the images');
  assert.equal(deleteManyCalls.length, 1);
  assert.deepEqual(deleteManyCalls[0]._id.$in.map(String), ['old']);
  assert.ok(deleteManyCalls[0].deletedAt?.$lte instanceof Date, 'the retention predicate is repeated on delete');
});

test('an empty trash costs nothing', async () => {
  const { janitor, deletedImageCalls, deleteManyCalls } = loadJanitor({ notes: [] });
  const result = await janitor.purgeExpiredTrash({ now });
  assert.deepEqual(result, { notes: 0, files: 0 });
  assert.equal(deletedImageCalls.length, 0);
  assert.equal(deleteManyCalls.length, 0, 'no deleteMany without expired notes');
});

test('orphaned images go, referenced and young files stay', async () => {
  const dir = tempDir();
  writeFile(dir, 'referenced.png', 10 * DAY_MS, 100);
  writeFile(dir, 'orphan.png', 10 * DAY_MS, 200);
  writeFile(dir, 'fresh-orphan.png', 60 * 1000, 50);
  writeFile(dir, '.gitkeep', 10 * DAY_MS, 0);

  const { janitor } = loadJanitor({
    notes: [{ _id: 'n1', deletedAt: new Date(now - 2 * DAY_MS), images: [{ filename: 'referenced.png' }] }]
  });

  const result = await janitor.removeOrphanedImages({ now, minAgeHours: 24, imagesDir: dir });

  assert.equal(result.files, 1, 'only the unreferenced old file is removed');
  assert.equal(result.bytes, 200);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.gitkeep', 'fresh-orphan.png', 'referenced.png']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('orphaned attachments go, referenced and young ones stay', async () => {
  const dir = tempDir();
  writeFile(dir, 'referenced.pdf', 10 * DAY_MS, 100);
  writeFile(dir, 'orphan.pdf', 10 * DAY_MS, 300);
  writeFile(dir, 'fresh-orphan.pdf', 60 * 1000, 50);
  writeFile(dir, '.gitkeep', 10 * DAY_MS, 0);

  const { janitor } = loadJanitor({
    notes: [{ _id: 'n1', deletedAt: new Date(now - 2 * DAY_MS), files: [{ filename: 'referenced.pdf' }] }]
  });

  const result = await janitor.removeOrphanedFiles({ now, minAgeHours: 24, filesDir: dir });

  assert.equal(result.files, 1, 'only the unreferenced old attachment is removed');
  assert.equal(result.bytes, 300);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.gitkeep', 'fresh-orphan.pdf', 'referenced.pdf']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a trashed note keeps its attachments (it is still a reference)', async () => {
  const dir = tempDir();
  writeFile(dir, 'trashed.pdf', 40 * DAY_MS, 10);
  const { janitor } = loadJanitor({
    notes: [{ _id: 'n1', deletedAt: new Date(now - 10 * DAY_MS), files: [{ filename: 'trashed.pdf' }] }]
  });

  const result = await janitor.removeOrphanedFiles({ now, minAgeHours: 24, filesDir: dir });

  assert.equal(result.files, 0);
  assert.deepEqual(fs.readdirSync(dir), ['trashed.pdf']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a trashed note keeps its images (it is still a reference)', async () => {
  const dir = tempDir();
  writeFile(dir, 'trashed.png', 40 * DAY_MS, 10);
  const { janitor } = loadJanitor({
    notes: [{ _id: 'n1', deletedAt: new Date(now - 10 * DAY_MS), images: [{ filename: 'trashed.png' }] }]
  });

  const result = await janitor.removeOrphanedImages({ now, minAgeHours: 24, imagesDir: dir });

  assert.equal(result.files, 0);
  assert.deepEqual(fs.readdirSync(dir), ['trashed.png']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('aborted uploads leave the temp directory again', async () => {
  const dir = tempDir();
  writeFile(dir, 'stale.tmp', 5 * 60 * 60 * 1000, 30);
  writeFile(dir, 'running.tmp', 10 * 1000, 30);

  const { janitor } = loadJanitor();
  const result = janitor.cleanTempUploads({ now: Date.now(), minAgeMinutes: 60, tempDir: dir });

  assert.equal(result.files, 1);
  assert.equal(result.bytes, 30);
  assert.deepEqual(fs.readdirSync(dir), ['running.tmp']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failing step is logged, never thrown, and the run still reports', async () => {
  const dir = tempDir();
  writeFile(dir, 'stale.tmp', 5 * 60 * 60 * 1000, 12);
  const { janitor } = loadJanitor({ failFind: true });

  // filesDir mitgeben: Ohne eigene Dateien kehrt der Schritt vor dem DB-Ruf
  // zurueck und der Fehlerzaehler waere vom Bestand im Repository abhaengig.
  const result = await janitor.runStorageJanitor({ now: Date.now(), tempDir: dir, filesDir: dir });

  assert.equal(result.errors.length, 3, 'all three database steps fail (purge, image orphans, attachment orphans)');
  assert.match(result.errors.join(' '), /mongo down/);
  assert.equal(result.temp.files, 1, 'the filesystem step still runs');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the janitor can be switched off and never holds the process open', () => {
  process.env.STORAGE_JANITOR_INTERVAL_HOURS = '0';
  delete require.cache[janitorPath];
  const disabled = require(janitorPath);
  assert.equal(disabled.startStorageJanitor(), null);
  delete process.env.STORAGE_JANITOR_INTERVAL_HOURS;

  delete require.cache[janitorPath];
  const enabled = require(janitorPath);
  const timers = enabled.startStorageJanitor({ initialDelayMs: 60 * 60 * 1000 });
  assert.equal(timers.length, 2, 'one delayed first run plus the recurring timer');
  assert.ok(timers.every((timer) => timer.hasRef?.() === false), 'timers must be unref’d');
  timers.forEach((timer) => clearTimeout(timer) || clearInterval(timer));
});

test('the TTL index stays a backstop behind the janitor retention', () => {
  const model = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');
  assert.match(model, /expireAfterSeconds: 31 \* 24 \* 60 \* 60/, 'MongoDB must delete later than the janitor');

  delete require.cache[janitorPath];
  const janitor = require(janitorPath);
  assert.equal(janitor.TRASH_RETENTION_DAYS, 30, 'the user-facing promise stays 30 days');

  // Die UI verspricht 30 Tage — das darf nicht still auseinanderlaufen.
  for (const file of ['de.js', 'en.js']) {
    const translations = fs.readFileSync(path.join(__dirname, '../../client/src/translations', file), 'utf8');
    assert.match(translations, /trashRetentionHint: '[^']*30/, `${file} documents the 30-day retention`);
  }
});

test('the janitor is wired into startup without delaying the listen call', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /const \{ startStorageJanitor \} = require\('\.\/services\/storageJanitor'\);/);
  assert.match(server, /startStorageJanitor\(\);/);
  assert.ok(
    server.indexOf('startStorageJanitor();') < server.indexOf('app.listen(PORT, HOST'),
    'it must be scheduled, not awaited — startup stays fast'
  );
  assert.match(server, /await connectDB\(\)[\s\S]*?syncIndexes\(\)[\s\S]*?startStorageJanitor\(\)/);
});
