const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

// Audit 2026-09-12 (Top-30 Nr. 21): `middleware/secureFileServe.js` ist das
// einzige Tor zu privaten Notizbildern — und war bis hierhin ungeprüft
// (`grep -rn secureFileServe server/tests client/tests client/e2e` → keine
// Treffer). Jede Runde wurde es von Hand probiert.

const noteModelPath = require.resolve('../models/Note');
const pathsPath = require.resolve('../config/paths');
const middlewarePath = require.resolve('../middleware/secureFileServe');

const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const FRIEND = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const STRANGER = 'cccccccccccccccccccccccc';

const uploadsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-fileserve-'));
fs.mkdirSync(path.join(uploadsRootDir, 'images'), { recursive: true });
fs.mkdirSync(path.join(uploadsRootDir, 'temp'), { recursive: true });

/**
 * Lädt die Middleware mit einem frischen Uploads-Verzeichnis und einer
 * Notiz-Tabelle, die über den Dateinamen aufgelöst wird.
 */
function loadServer(notesByFilename) {
  process.env.UPLOADS_DIR = uploadsRootDir;

  const queries = [];
  const NoteMock = {
    findOne: async (query) => {
      queries.push(query);
      const wanted = query.$or.map(rule => rule['images.filename'] || rule['images.thumbnailFilename']);
      for (const name of wanted) {
        if (notesByFilename[name]) return notesByFilename[name];
      }
      return null;
    }
  };

  for (const modulePath of [middlewarePath, pathsPath]) delete require.cache[modulePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  // Einmal laden, damit UPLOADS_DIR und die Notiz-Tabelle zusammengehören.
  require(middlewarePath);
  return { queries };
}

/** Echter HTTP-Aufruf gegen die Middleware (req.user wird gesetzt wie von authenticateToken). */
async function get(urlPath, userId = OWNER) {
  const app = express();
  app.get('/uploads/*', (req, _res, next) => { req.user = { _id: userId }; next(); }, require(middlewarePath));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${urlPath}`);
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      body: await response.text()
    };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function writeImage(name, content = 'image-bytes') {
  const file = path.join(uploadsRootDir, 'images', name);
  fs.writeFileSync(file, content);
  return file;
}

const note = (ownerId, filenames, extra = {}) => ({
  _id: 'note-1',
  userId: ownerId,
  sharedWith: extra.sharedWith || [],
  deletedAt: extra.deletedAt || null,
  images: filenames.map(filename => ({ filename, thumbnailFilename: `${filename.replace(/\.[^.]+$/, '')}-thumb.webp` }))
});

test('the owner gets the image with a private cache header', async () => {
  const fileName = 'owner.png';
  writeImage(fileName, 'ORIGINAL');
  loadServer({ [fileName]: note(OWNER, [fileName]), 'owner-thumb.webp': note(OWNER, [fileName]) });

  const result = await get(`/uploads/images/${fileName}`, OWNER);
  assert.equal(result.status, 200);
  assert.equal(result.body, 'ORIGINAL');
  assert.equal(result.cacheControl, 'private, no-store', 'private images must never be cached by proxies');
});

test('a collaborator gets the image, a stranger does not', async () => {
  const fileName = 'shared.png';
  writeImage(fileName, 'SHARED');
  loadServer({ [fileName]: note(OWNER, [fileName], { sharedWith: [FRIEND] }) });

  const friend = await get(`/uploads/images/${fileName}`, FRIEND);
  assert.equal(friend.status, 200);
  assert.equal(friend.body, 'SHARED');

  const stranger = await get(`/uploads/images/${fileName}`, STRANGER);
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.includes('SHARED'), false, 'no bytes for an unauthorized caller');
});

test('an unknown file is a 404, not a directory listing', async () => {
  loadServer({});
  const result = await get('/uploads/images/does-not-exist.png', OWNER);
  assert.equal(result.status, 404);
});

test('path traversal and non-image locations are refused before any lookup', async () => {
  const fileName = 'traversal.png';
  writeImage(fileName, 'SECRET');
  fs.writeFileSync(path.join(uploadsRootDir, 'temp', 'audio.webm'), 'AUDIO');
  const { queries } = loadServer({ [fileName]: note(OWNER, [fileName]) });

  const rejectedBeforeLookup = [
    '/uploads/images/../server.js',
    '/uploads/images/..%2fserver.js',
    '/uploads/temp/audio.webm',
    '/uploads/images/sub/dir.png',
    '/uploads/images/',
    '/uploads/'
  ];
  for (const urlPath of rejectedBeforeLookup) {
    const result = await get(urlPath, OWNER);
    assert.ok(result.status === 404 || result.status === 403, `${urlPath} -> ${result.status}`);
    assert.equal(result.body.includes('SECRET'), false, `${urlPath} must not leak the image`);
    assert.equal(result.body.includes('AUDIO'), false, `${urlPath} must not leak temp uploads`);
  }
  assert.equal(queries.length, 0, 'paths rejected by the route regex must not reach the database');

  // Doppelt encodiert (%252f) kommt der Pfad als gewöhnlicher Dateiname durch die
  // Regex. Entscheidend ist, dass basename+resolve+startsWith ihn im
  // Bilder-Verzeichnis halten und die Datenbank nur einen flachen Namen sieht.
  const encoded = await get('/uploads/images/..%252f..%252fserver.js', OWNER);
  assert.equal(encoded.status, 404);
  assert.equal(encoded.body.includes('SECRET'), false);
  assert.equal(queries.length, 1, 'exactly the double-encoded name is looked up');
  for (const rule of queries[0].$or) {
    const value = rule['images.filename'] || rule['images.thumbnailFilename'];
    assert.equal(value.includes('/'), false, 'no separator may reach the query');
    assert.equal(value.includes('\\'), false, 'no backslash may reach the query');
    assert.equal(path.basename(value), value, 'only a flat basename is queried');
  }
});

test('thumbnails are authorized through the same note lookup', async () => {
  const fileName = 'thumb-base.png';
  writeImage(fileName, 'ORIGINAL');
  writeImage('thumb-base-thumb.webp', 'THUMBNAIL');
  loadServer({
    [fileName]: note(OWNER, [fileName], { sharedWith: [FRIEND] }),
    'thumb-base-thumb.webp': note(OWNER, [fileName], { sharedWith: [FRIEND] })
  });

  const owner = await get('/uploads/images/thumb-base-thumb.webp', OWNER);
  assert.equal(owner.status, 200);
  assert.equal(owner.body, 'THUMBNAIL');

  const stranger = await get('/uploads/images/thumb-base-thumb.webp', STRANGER);
  assert.equal(stranger.status, 403);
});

test('a trashed note keeps its images for the owner but not for others', async () => {
  const fileName = 'trashed.png';
  writeImage(fileName, 'TRASHED');
  loadServer({ [fileName]: note(OWNER, [fileName], { deletedAt: new Date(), sharedWith: [FRIEND] }) });

  const owner = await get(`/uploads/images/${fileName}`, OWNER);
  assert.equal(owner.status, 200, 'thumbnails in the trash must keep working (VERBESSERUNGEN #106)');

  const stranger = await get(`/uploads/images/${fileName}`, STRANGER);
  assert.equal(stranger.status, 403);
});

test('a referenced file that is gone answers 404 with a distinct message', async () => {
  loadServer({ 'missing.png': note(OWNER, ['missing.png']) });
  const result = await get('/uploads/images/missing.png', OWNER);
  assert.equal(result.status, 404);
  assert.match(result.body, /Datei nicht auf dem Server gefunden/);
});

test('both traversal guards exist: the path regex and the resolved prefix check', () => {
  const source = fs.readFileSync(path.join(__dirname, '../middleware/secureFileServe.js'), 'utf8');
  assert.ok(source.includes(String.raw`/^images\/[^/\\]+$/`), 'the route only accepts images/<basename>');
  assert.match(source, /filepath\.startsWith\(imagesDir \+ path\.sep\)/, 'the resolved path must stay inside the images directory');
  assert.match(source, /uploadsRoot\(\)/, 'the directory comes from config/paths, not from a hardcoded relative path');
  assert.match(source, /res\.setHeader\('Cache-Control', 'private, no-store'\)/);
});

test.after(() => {
  fs.rmSync(uploadsRootDir, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});
