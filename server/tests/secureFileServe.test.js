const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

// Audit 2026-09-12 (Top-30 Nr. 21): `middleware/secureFileServe.js` ist das
// einzige Tor zu privaten Notizbildern — und war bis hierhin ungeprüft
// (`grep -rn secureFileServe server/tests client/tests client/e2e` → keine
// Treffer). Jede Runde wurde es von Hand probiert.
// v1.15.0: Uploads dürfen jetzt gecacht werden (private + immutable statt
// no-store), denn der Random-Hex-Speichername wird nie wiederverwendet —
// revalidiert wird über den ETag aus sendFile. Beides wird hier mit echter
// HTTP-Semantik gegen einen echten Express-Server geprüft.

const noteModelPath = require.resolve('../models/Note');
const pathsPath = require.resolve('../config/paths');
const middlewarePath = require.resolve('../middleware/secureFileServe');

const OWNER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const FRIEND = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const STRANGER = 'cccccccccccccccccccccccc';

const uploadsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-fileserve-'));
fs.mkdirSync(path.join(uploadsRootDir, 'images'), { recursive: true });
fs.mkdirSync(path.join(uploadsRootDir, 'files'), { recursive: true });
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
      if (query['files.filename']) {
        return notesByFilename[query['files.filename']] || null;
      }
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
      contentType: response.headers.get('content-type'),
      contentDisposition: response.headers.get('content-disposition'),
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

/** Startet die Middleware hinter echtem Express (ein Nutzer pro Server-Instanz). */
async function startServer(userId = OWNER) {
  const app = express();
  app.get('/uploads/*', (req, _res, next) => { req.user = { _id: userId }; next(); }, require(middlewarePath));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return { port: server.address().port, close: () => server.close() };
}

/**
 * Roher GET über node:http statt fetch — nötig für Revalidation: undici-fetch
 * schickt bei If-None-Match von sich aus `cache-control: no-cache` mit
 * (Cache-Mode der Fetch-Spec), und fresh() behandelt so einen Request korrekt
 * als stale. Ein 304 wäre über fetch also nie beobachtbar, obwohl ein echter
 * Browser es bekommt. Der rohe Client schickt nur, was wir ihm geben.
 */
function rawGet(port, urlPath, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers: extraHeaders }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end();
  });
}

function writeAttachment(name, content = '%PDF-1.7-bytes') {
  const file = path.join(uploadsRootDir, 'files', name);
  fs.writeFileSync(file, content);
  return file;
}

/** Notiz mit PDF-Anhang: images leer, files mit Speicher- und Originalnamen. */
const attachmentNote = (ownerId, filename, originalName = 'Bericht 2026.pdf', extra = {}) => ({
  ...note(ownerId, [], extra),
  files: [{ filename, originalName, mimetype: 'application/pdf', size: 42 }]
});

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
  // v1.15.0: private + immutable statt no-store — private Bilder bleiben aus
  // Shared Proxies raus, dürfen aber im Browser ein Jahr liegen bleiben.
  assert.equal(result.cacheControl, 'private, max-age=31536000, immutable', 'private images must never be cached by proxies');
});

// v1.15.0: Der Random-Hex-Speichername wird nie mutiert, also darf der Browser
// Bytes wiederverwenden, statt jedes Notizoeffnen alle Bilder und PDFs neu zu
// laden. Genau dieser Header, kein no-store, und nie public.
test('uploads become cacheable: exactly one year, immutable, never no-store', async () => {
  writeImage('cacheable.png', 'CACHEABLE-IMAGE');
  writeAttachment('cacheable.pdf', '%PDF-1.7');
  loadServer({
    'cacheable.png': note(OWNER, ['cacheable.png']),
    'cacheable.pdf': attachmentNote(OWNER, 'cacheable.pdf')
  });

  for (const urlPath of ['/uploads/images/cacheable.png', '/uploads/files/cacheable.pdf']) {
    const result = await get(urlPath, OWNER);
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, 'private, max-age=31536000, immutable', `${urlPath}: the exact v1.15.0 policy, images and attachments alike`);
    assert.equal(result.cacheControl.includes('no-store'), false, `${urlPath}: no-store would force a full re-download forever`);
    assert.equal(result.cacheControl.includes('public'), false, `${urlPath}: uploads must stay out of shared proxies`);
  }
});

// sendFile liefert ETag/Last-Modified mit; ein Browser revalidiert dann mit
// If-None-Match. Über den rohen Client (siehe rawGet) bekommt der 304-Fall
// dieselbe private Policy — sonst würde ein Proxy den 304 nicht als Aktualität
// des Cache-Eintrags verstehen.
test('revalidation: If-None-Match answers 304 without a body, a stale or missing validator answers with one', async () => {
  writeImage('revalidate.png', 'REVALIDATE-BYTES');
  loadServer({ 'revalidate.png': note(OWNER, ['revalidate.png']) });
  const { port, close } = await startServer(OWNER);
  try {
    // Erster Abruf ohne Validator: voller Körper, plus die Validatoren für später.
    const first = await rawGet(port, '/uploads/images/revalidate.png');
    assert.equal(first.status, 200);
    assert.equal(first.body, 'REVALIDATE-BYTES');
    assert.equal(first.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.ok(first.headers.etag, 'sendFile must expose an ETag, otherwise no client can revalidate');
    assert.ok(first.headers['last-modified'], 'and a Last-Modified as the coarse fallback');

    // Gleicher ETag zurückgeschickt: 304 ohne Bytes — der gesparte Download.
    const fresh = await rawGet(port, '/uploads/images/revalidate.png', { 'If-None-Match': first.headers.etag });
    assert.equal(fresh.status, 304, 'unchanged content must not be sent twice');
    assert.equal(fresh.body, '', 'a 304 carries no bytes');
    assert.equal(fresh.headers['cache-control'], 'private, max-age=31536000, immutable', 'the 304 keeps the private policy so the cached entry stays browser-only');

    // Falscher ETag: wieder voller Körper, nichts wird blind als frisch behauptet.
    const stale = await rawGet(port, '/uploads/images/revalidate.png', { 'If-None-Match': '"stale-etag"' });
    assert.equal(stale.status, 200);
    assert.equal(stale.body, 'REVALIDATE-BYTES', 'a mismatching ETag gets the full response');
  } finally {
    close();
  }
});

// Fehler antworten für einen konkreten, fehlgeschlagenen Abruf — sie dürfen
// dem Aufrufer keine Policy mitgeben, die er für den Inhalt cachen könnte.
test('error paths set no success cache header at all', async () => {
  writeImage('forbidden.png', 'FORBIDDEN');
  loadServer({ 'forbidden.png': note(OWNER, ['forbidden.png']) });

  const stranger = await get('/uploads/images/forbidden.png', STRANGER);
  assert.equal(stranger.status, 403);
  assert.equal(stranger.cacheControl, null, 'a denial must not advertise any caching');

  const missing = await get('/uploads/images/never-existed.png', OWNER);
  assert.equal(missing.status, 404);
  assert.equal(missing.cacheControl, null, 'a 404 must not inherit the immutable policy either');
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
  assert.ok(source.includes(String.raw`/^files\/[^/\\]+$/`), 'the route only accepts files/<basename>');
  assert.match(source, /filepath\.startsWith\(baseDir \+ path\.sep\)/, 'the resolved path must stay inside its base directory');
  assert.match(source, /uploadsRoot\(\)/, 'the directory comes from config/paths, not from a hardcoded relative path');
  // v1.15.0: exakt eine Cache-Control-Zeile, und die ist private+immutable.
  const cacheControlLines = source.split('\n').filter(line => line.includes("setHeader('Cache-Control'"));
  assert.equal(cacheControlLines.length, 1, 'exactly one place decides the caching policy');
  assert.match(cacheControlLines[0], /'private, max-age=31536000, immutable'/, 'uploads are cacheable for the browser only');
  assert.doesNotMatch(cacheControlLines[0], /no-store/, 'no-store would defeat revalidation entirely');
});

test('attachments download with PDF headers and the original filename', async () => {
  writeAttachment('report.pdf', '%PDF-1.7');
  loadServer({ 'report.pdf': attachmentNote(OWNER, 'report.pdf', 'Bericht 2026.pdf', { sharedWith: [FRIEND] }) });

  const owner = await get('/uploads/files/report.pdf', OWNER);
  assert.equal(owner.status, 200);
  assert.equal(owner.body, '%PDF-1.7');
  assert.equal(owner.contentType, 'application/pdf', 'the type is fixed, never sniffed');
  assert.match(owner.contentDisposition, /^attachment; /, 'PDFs must download, not render inline');
  assert.match(owner.contentDisposition, /filename\*=UTF-8''Bericht%202026\.pdf/, 'RFC 5987 keeps spaces and umlauts intact');
  assert.equal(owner.cacheControl, 'private, max-age=31536000, immutable', 'attachments benefit from the same immutability');

  const friend = await get('/uploads/files/report.pdf', FRIEND);
  assert.equal(friend.status, 200, 'collaborators reach shared attachments');

  const stranger = await get('/uploads/files/report.pdf', STRANGER);
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.includes('%PDF'), false, 'no bytes for an unauthorized caller');
});

test('an attachment without originalName still downloads as anhang.pdf', async () => {
  writeAttachment('hex1234.pdf');
  loadServer({ 'hex1234.pdf': attachmentNote(OWNER, 'hex1234.pdf', undefined) });

  const result = await get('/uploads/files/hex1234.pdf', OWNER);
  assert.equal(result.status, 200);
  assert.match(result.contentDisposition, /filename="anhang\.pdf"/);
});

test('an unknown attachment is a 404, and traversal into images is not routed', async () => {
  loadServer({});
  const missing = await get('/uploads/files/nope.pdf', OWNER);
  assert.equal(missing.status, 404);

  writeImage('secret.png', 'SECRET');
  const traversal = await get('/uploads/files/..%2Fimages%2Fsecret.png', OWNER);
  assert.equal(traversal.status, 404, 'the path regex only accepts files/<basename>');
});

test.after(() => {
  fs.rmSync(uploadsRootDir, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});
