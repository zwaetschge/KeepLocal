process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

// v1.17.0-Runde: funktional getestete serverseitige Fixes, die in ihren
// eigenen Suiten keinen Platz hatten —
//   Nr. 6  ZIP-Import validiert Dateianhänge wie der Multipart-Pfad
//          (.pdf-Whitelist + %PDF- Magic Bytes),
//   Nr. 7  Bild-Pipeline: EXIF-Orientation landet gedreht im Thumbnail, und
//          die ausgelieferten Originale verlieren EXIF/GPS,
//   Nr. 10 Transkription: das AbortSignal der Route erreicht den Axios-Call,
//   Nr. 13 errorHandler loggt 4xx auf warn, nur 5xx auf error,
//   + Source-Pins für die Demo-Guards, den Storage-Endpoint und die
//     Abort-Verdrahtung der Transkriptions-Route.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const loggerPath = require.resolve('../utils/logger');

const USER = '507f191e810c19729de86011';

let uploadsRoot;
function setupUploads() {
  uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-v117-'));
  process.env.UPLOADS_DIR = uploadsRoot;
  fs.mkdirSync(path.join(uploadsRoot, 'images'), { recursive: true });
  fs.mkdirSync(path.join(uploadsRoot, 'files'), { recursive: true });
  return uploadsRoot;
}
function teardownUploads() {
  fs.rmSync(uploadsRoot, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
}

function leanChain(docs) {
  return {
    select: () => leanChain(docs),
    sort: () => leanChain(docs),
    lean: async () => docs,
    then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject)
  };
}

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  delete require.cache[require.resolve('../config/paths')];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

function modelOver({ notes = [], inserted = [] } = {}) {
  return {
    inserted,
    find: () => leanChain(notes),
    findOne: () => leanChain(null),
    countDocuments: async () => notes.length,
    insertMany: async (docs) => {
      inserted.push(...docs);
      return docs;
    }
  };
}

// ---------------------------------------------------------------------------
// Nr. 6 — ZIP-Import: Dateianhänge unterliegen denselben Regeln wie der
// Multipart-Upload. Vorher nahm der Import JEDE Endung mit JEDEM Inhalt an
// und schrieb sie nach uploads/files (secureFileServe stellt per sendFile
// nach Endung aus — ein .html-Eintrag wäre Stored XSS gewesen).
// ---------------------------------------------------------------------------

test('ZIP-Import weist Dateianhänge mit verbotener Endung ab', async () => {
  const root = setupUploads();
  try {
    const service = loadService(modelOver({}));
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('assets/files/payload.html', Buffer.from('<script>alert(1)</script>'));
    zip.add('notiz.md', Buffer.from('# Hallo'));

    await assert.rejects(
      () => service.importMarkdownZip(USER, zip.finish()),
      /nur PDF- oder Bild-Dateien erlaubt/
    );
    assert.equal(fs.readdirSync(path.join(root, 'files')).length, 0, 'keine Datei bleibt zurück');
  } finally {
    teardownUploads();
  }
});

test('ZIP-Import prüft %PDF- Magic Bytes auch bei korrekter Endung', async () => {
  const root = setupUploads();
  try {
    const service = loadService(modelOver({}));
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('assets/files/fake.pdf', Buffer.from('<!DOCTYPE html>kein PDF'));
    zip.add('notiz.md', Buffer.from('# Hallo'));

    await assert.rejects(
      () => service.importMarkdownZip(USER, zip.finish()),
      /nur PDF- oder Bild-Dateien erlaubt/
    );
    assert.equal(fs.readdirSync(path.join(root, 'files')).length, 0);
  } finally {
    teardownUploads();
  }
});

test('ZIP-Import nimmt echte PDFs an und trägt sie mit application/pdf ein', async () => {
  const root = setupUploads();
  try {
    const inserted = [];
    const service = loadService(modelOver({ inserted }));
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('assets/files/bericht.pdf', Buffer.from('%PDF-1.7 v117-roundtrip'));
    zip.add('notiz.md', Buffer.from('# Hallo\n\nSiehe [PDF](assets/files/bericht.pdf).'));

    const result = await service.importMarkdownZip(USER, zip.finish());
    assert.ok(result.created >= 1);
    const stored = fs.readdirSync(path.join(root, 'files'));
    assert.equal(stored.filter((name) => name.endsWith('.pdf')).length, 1, 'das PDF liegt in files/');
    const noteWithFile = inserted.find((note) => (note.files || []).length > 0);
    assert.ok(noteWithFile, 'die importierte Notiz referenziert den Anhang');
    assert.equal(noteWithFile.files[0].mimetype, 'application/pdf');
  } finally {
    teardownUploads();
  }
});

// ---------------------------------------------------------------------------
// Nr. 7 — Bild-Pipeline: EXIF-Orientation + Metadaten-Strip der Originale.
// ---------------------------------------------------------------------------

/** Querformat-Basis (40x20) mit Orientation 6 (90° CW) und Canary-EXIF. */
async function exifPortraitJpeg() {
  const base = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#3366aa' }
  }).png().toBuffer();
  return sharp(base)
    // orientation (Zahl) setzt den EXIF-Tag, exif.IFD0 den Canary-Text —
    // beides zusammen ergibt ein realistisches Handyfoto.
    .withMetadata({ orientation: 6, exif: { IFD0: { ImageDescription: 'v117-secret-canary' } } })
    .jpeg()
    .toBuffer();
}

test('stripImageMetadata entfernt EXIF und backt die Orientation in die Pixel', async () => {
  const root = setupUploads();
  try {
    const filepath = path.join(root, 'images', 'exif.jpg');
    fs.writeFileSync(filepath, await exifPortraitJpeg());

    const before = await sharp(filepath).metadata();
    assert.ok(before.exif, 'Testvorbedingung: die Quelle trägt EXIF');
    assert.equal(before.orientation, 6);

    const service = loadService(modelOver({}));
    const newSize = await service.stripImageMetadata(filepath);
    assert.ok(Number.isInteger(newSize) && newSize > 0, 'die neue Größe wird gemeldet');

    const after = await sharp(filepath).metadata();
    assert.equal(after.exif, undefined, 'EXIF (inkl. GPS-Felder) ist weg');
    assert.equal(after.orientation, undefined, 'kein Orientation-Tag mehr — der Dreh sitzt in den Pixeln');
    assert.equal(after.width, 20, 'die 90°-Drehung ist eingebaut: quer wurde hochkant');
    assert.equal(after.height, 40);
    assert.ok(!fs.existsSync(`${filepath}.clean`), 'kein .clean-Rest bleibt liegen');
  } finally {
    teardownUploads();
  }
});

test('stripImageMetadata lässt Bilder ohne EXIF byte-identisch in Ruhe', async () => {
  const root = setupUploads();
  try {
    const base = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#112233' }
    }).jpeg().toBuffer();
    const filepath = path.join(root, 'images', 'clean.jpg');
    fs.writeFileSync(filepath, base);

    const service = loadService(modelOver({}));
    const result = await service.stripImageMetadata(filepath);
    assert.equal(result, null, 'nichts zu tun → null, keine Größenänderung');
    assert.deepEqual(fs.readFileSync(filepath), base, 'die Bytes bleiben identisch');
  } finally {
    teardownUploads();
  }
});

test('generateThumbnail dreht EXIF-orientierte Fotos vor dem Resize', async () => {
  const root = setupUploads();
  try {
    const filepath = path.join(root, 'images', 'handyfoto.jpg');
    fs.writeFileSync(filepath, await exifPortraitJpeg());

    const service = loadService(modelOver({}));
    const thumbnail = await service.generateThumbnail('handyfoto.jpg', filepath);
    assert.match(thumbnail, /-thumb\.webp$/);

    const meta = await sharp(path.join(root, 'images', thumbnail)).metadata();
    // 40x20 quer mit Orientation 6 → hochkant 20x40: Das Thumbnail muss
    // HOCH sein, sonst zeigte die Übersicht das Foto seitlich gekippt.
    assert.ok(meta.height > meta.width, `Thumbnail muss hochkant sein, ist ${meta.width}x${meta.height}`);
  } finally {
    teardownUploads();
  }
});

// ---------------------------------------------------------------------------
// Nr. 10 — Transkription: das Signal der Route erreicht den Upstream-Call.
// ---------------------------------------------------------------------------

test('transcribeAudio reicht das AbortSignal an axios durch', async () => {
  const axiosPath = require.resolve('axios');
  const originalAxios = require.cache[axiosPath];
  const aiPath = require.resolve('../services/aiService');
  delete require.cache[aiPath];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-ai-'));
  const audioPath = path.join(dir, 'aufnahme.webm');
  fs.writeFileSync(audioPath, 'fake-audio-bytes');

  let capturedConfig = null;
  try {
    require.cache[axiosPath] = {
      id: axiosPath, filename: axiosPath, loaded: true,
      exports: { post: async (_url, _data, config) => { capturedConfig = config; return { data: { text: 'ok' } }; } }
    };
    delete require.cache[aiPath];
    const aiService = require(aiPath);
    const controller = new AbortController();
    const result = await aiService.transcribeAudio(audioPath, null, 'req-v117', controller.signal);

    assert.equal(result.text, 'ok');
    assert.equal(capturedConfig.signal, controller.signal, 'das Signal hängt am axios-Call');
    assert.equal(capturedConfig.headers['X-Request-Id'], 'req-v117');
  } finally {
    delete require.cache[aiPath];
    if (originalAxios) require.cache[axiosPath] = originalAxios;
    else delete require.cache[axiosPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Transkriptions-Route koppelt den Upstream-Call an die Connection', () => {
  const routes = fs.readFileSync(require.resolve('../routes/notes.js'), 'utf8');
  // Der Abbruch-Läufer: close OHNE beendete Antwort → abort().
  // (v1.17.1: Layout-lockere Matcher — der Pin soll Semantik sichern, keine
  // Zeilenumbrüche einfrieren.)
  assert.match(routes, /res\.on\('close', \(\) => \{[\s\S]*?if \(!res\.writableEnded\) clientGone\.abort\(\);/);
  // Signal wandert in den Service-Call …
  assert.match(routes, /transcribeAudio\(req\.file\.path, language, req\.id, clientGone\.signal\)/);
  // … und ein abgebrochener Call wird still beendet (kein Log-Noise, kein Buchen).
  assert.match(routes, /error\?\.code === 'ERR_CANCELED'/);
  assert.match(routes, /if \(clientGone\.signal\.aborted\) \{/);
});

// ---------------------------------------------------------------------------
// Nr. 13 — errorHandler: 4xx ist Routine (warn), 5xx bleibt error.
// ---------------------------------------------------------------------------

test('errorHandler loggt 4xx auf warn und nur 5xx auf error', () => {
  const handlerPath = require.resolve('../middleware/errorHandler');
  const originalLogger = require.cache[loggerPath];
  const calls = [];
  require.cache[loggerPath] = {
    id: loggerPath, filename: loggerPath, loaded: true,
    exports: {
      warn: (message, meta) => calls.push({ level: 'warn', message, meta }),
      error: (message, meta) => calls.push({ level: 'error', message, meta }),
      info() {}, debug() {}
    }
  };
  try {
    delete require.cache[handlerPath];
    const errorHandler = require(handlerPath);

    const respond = () => ({ status() { return this; }, json() { return this; } });
    errorHandler({ statusCode: 400, message: 'Kaputte Payload' }, { id: 'r1', method: 'POST', originalUrl: '/api/x' }, respond());
    errorHandler({ statusCode: 413, message: 'Quota', code: 'STORAGE_QUOTA_EXCEEDED' }, { id: 'r2', method: 'POST', originalUrl: '/api/y' }, respond());
    errorHandler(new Error('Datenbank explodiert'), { id: 'r3', method: 'GET', originalUrl: '/api/z' }, respond());
    // CastError: kein statusCode am Fehler — die Klassifizierung muss VOR dem
    // Loggen laufen, sonst landet das 400 als error im Log.
    const cast = new Error('Cast to ObjectId failed');
    cast.name = 'CastError';
    errorHandler(cast, { id: 'r4', method: 'GET', originalUrl: '/api/notes/kaputte-id' }, respond());

    assert.deepEqual(calls.map((entry) => `${entry.level}:${entry.meta.status}`),
      ['warn:400', 'warn:413', 'error:500', 'warn:400'],
      'erst die Klassifizierung, dann der Level — ein CastError ist kein 500er');
    assert.ok(calls[2].meta.stack, '5xx behält den Stack');
    assert.equal(calls[1].meta.code, 'STORAGE_QUOTA_EXCEEDED', 'der Fehlercode reist weiter ins Log');
  } finally {
    delete require.cache[handlerPath];
    if (originalLogger) require.cache[loggerPath] = originalLogger;
    else delete require.cache[loggerPath];
  }
});

// ---------------------------------------------------------------------------
// Source-Pins: Demo-Guards (Nr. 5) + Storage-Endpoint (Nr. 11).
// ---------------------------------------------------------------------------

test('die vier Demo-Lücken-Routen tragen den blockDemoMaintenance-Guard', () => {
  const routes = fs.readFileSync(require.resolve('../routes/notes.js'), 'utf8');
  for (const route of [
    "router.get('/export/markdown', blockDemoMaintenance",
    "router.delete('/trash', blockDemoMaintenance",
    "router.patch('/tags', blockDemoMaintenance",
    "router.patch('/reorder', blockDemoMaintenance"
  ]) {
    assert.ok(routes.includes(route), `fehlender Demo-Guard: ${route}`);
  }
});

test('GET /api/auth/storage liefert dem Owner sein Quota-Budget', () => {
  const auth = fs.readFileSync(require.resolve('../routes/auth.js'), 'utf8');
  assert.match(auth, /router\.get\('\/storage', authenticateToken/);
  assert.match(auth, /getStorageUsage\(req\.user\._id\)/);
  assert.match(auth, /quotaLimitBytes\(\)/);
  assert.match(auth, /enforced: limitBytes > 0/);
});

// ---------------------------------------------------------------------------
// v1.17.1 — Review-Fixes der v1.17.0-Runde
// ---------------------------------------------------------------------------

test('ZIP-Import nimmt Legacy-Bildanhänge per Magic-Bytes an (Roundtrip)', async () => {
  // Review-Fund: LEGACY-Exporte tragen Bilder als Dateianhang unter
  // assets/files/ (hochgeladen, bevor der Multipart-Pfad PDF-only wurde).
  // Die v1.17.0-Endungsprüfung wies sie hart ab — der komplette Restore
  // scheiterte an einem einzigen alten Foto.
  const root = setupUploads();
  try {
    const inserted = [];
    const service = loadService(modelOver({ inserted }));
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('assets/files/altes-foto.dat', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]));
    zip.add('notiz.md', Buffer.from('# Album\n\n![alt](assets/files/altes-foto.dat)'));

    const result = await service.importMarkdownZip(USER, zip.finish());
    assert.ok(result.created >= 1);
    const stored = fs.readdirSync(path.join(root, 'files'));
    // Endung folgt dem ERKANNTEN Inhalt (.jpg), nicht dem ZIP-Namen (.dat):
    // secureFileServe leitet den Content-Type aus der Endung ab.
    assert.equal(stored.filter((name) => name.endsWith('.jpg')).length, 1,
      'das JPEG liegt mit erkannter Endung in files/');
    const noteWithFile = inserted.find((note) => (note.files || []).length > 0);
    assert.ok(noteWithFile, 'die importierte Notiz referenziert den Anhang');
    assert.equal(noteWithFile.files[0].mimetype, 'image/jpeg');
  } finally {
    teardownUploads();
  }
});

test('ZIP-Import weist fake-Bildanhänge ab (Endung jpg, Inhalt HTML)', async () => {
  const root = setupUploads();
  try {
    const service = loadService(modelOver());
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('assets/files/preview.jpg', Buffer.from('<!DOCTYPE html><script>alert(1)</script>'));
    zip.add('notiz.md', Buffer.from('# Hallo'));

    await assert.rejects(
      () => service.importMarkdownZip(USER, zip.finish()),
      /Magic-Bytes/,
      'nur PDF- oder Bild-Inhalt kommt durch — der Name allein nie'
    );
    assert.equal(fs.readdirSync(path.join(root, 'files')).length, 0, 'kein Byte bleibt liegen');
  } finally {
    teardownUploads();
  }
});

test('shouldStripImageMetadata: Animation bleibt byte-identisch, EXIF-JPEG wird encodiert', async () => {
  const service = loadService(modelOver());
  const { shouldStripImageMetadata } = service;
  const exif = { hasExif: true };

  // Statisches JPEG mit EXIF: der Normalfall, wird gere-encodet.
  assert.equal(shouldStripImageMetadata({ format: 'jpeg', exif, pages: 1 }), true);
  assert.equal(shouldStripImageMetadata({ format: 'jpeg', exif, pages: undefined }), true);
  // Ohne EXIF gibt es nichts zu strippen.
  assert.equal(shouldStripImageMetadata({ format: 'jpeg', exif: null }), false);
  // Animiertes WebP (sharp meldet pages > 1): Re-Encode würde auf Frame 1
  // kollabieren — Fund aus dem v1.17.0-Review.
  assert.equal(shouldStripImageMetadata({ format: 'webp', exif, pages: 7 }), false);
  // APNG tarnt sich als einframe-PNG; der acTL-Chunk liegt zwingend vor IDAT.
  const apngHead = Buffer.alloc(128);
  apngHead.write('acTL', 33, 'latin1');
  assert.equal(shouldStripImageMetadata({ format: 'png', exif, pages: 1 }, apngHead), false);
  const staticPngHead = Buffer.alloc(128);
  assert.equal(shouldStripImageMetadata({ format: 'png', exif, pages: 1 }, staticPngHead), true);
  // GIF und Exoten bleiben außen vor (Kollateral > Nutzen).
  assert.equal(shouldStripImageMetadata({ format: 'gif', exif, pages: 1 }), false);
  assert.equal(shouldStripImageMetadata({ format: 'avif', exif, pages: 1 }), false);
});

test('aiService loggt Client-Abbruch auf warn, nicht auf error', async () => {
  // Review-Fund: der ERR_CANCELED-Fall (Route abortet das Signal, weil der
  // Client weg ist) lief als error ins Log — jeder abgebrochene Upload war
  // ein Incident. Behavioral: axios wirft ERR_CANCELED, der Logger-Stub
  // darf warn sehen, aber kein error.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-ai-cancel-'));
  const axiosPath = require.resolve('axios');
  const aiPath = require.resolve('../services/aiService');
  const originalAxios = require.cache[axiosPath];
  const originalLogger = require.cache[loggerPath];
  const calls = [];
  try {
    fs.writeFileSync(path.join(dir, 'memo.webm'), Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x00, 0x00]));
    require.cache[axiosPath] = {
      id: axiosPath, filename: axiosPath, loaded: true,
      exports: {
        post: async () => {
          const err = new Error('canceled');
          err.code = 'ERR_CANCELED';
          throw err;
        }
      }
    };
    require.cache[loggerPath] = {
      id: loggerPath, filename: loggerPath, loaded: true,
      exports: {
        warn: (message, meta) => calls.push({ level: 'warn', message }),
        error: (message, meta) => calls.push({ level: 'error', message })
      }
    };
    delete require.cache[aiPath];
    const aiService = require(aiPath);

    await assert.rejects(
      () => aiService.transcribeAudio(path.join(dir, 'memo.webm'), null, 'req-cancel'),
      (error) => error.code === 'ERR_CANCELED'
    );
    assert.ok(calls.some((c) => c.level === 'warn' && /abort/i.test(c.message)),
      'Abbruch ist warn-würdig');
    assert.ok(!calls.some((c) => c.level === 'error'),
      'kein error-Log für den Designed-Fall');
  } finally {
    delete require.cache[aiPath];
    if (originalAxios) require.cache[axiosPath] = originalAxios;
    else delete require.cache[axiosPath];
    if (originalLogger) require.cache[loggerPath] = originalLogger;
    else delete require.cache[loggerPath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

