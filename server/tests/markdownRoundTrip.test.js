const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// v1.13.0 Nr. 7 — Export-Round-trip: Der Markdown-Export war ein Lesen-ohne-
// Zurueckkommen: keine Metadaten (Tags wurden zu `#zeilen`, Pin/Archiv/Code/
// Farbe/Erinnerung fielen weg), keine Anhaenge. Jetzt: YAML-Frontmatter +
// assets/ + Manifest im ZIP, serverseitiger ZIP-Reader, Import verschmilzt
// _index.md mit dem Ordnerknoten und stellt alles inkl. frischer Thumbnails
// wieder her. Dieser Test laeuft mit ECHTEM Dateisystem und ECHTEM Archiv.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const { readZipEntries } = require('../utils/zipReader');

const USER = '507f191e810c19729de86011';

// Minimaler, echter 1x1-PNG (sharp kann ihn thumbnailen).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let uploadsRoot;
function setupUploads() {
  uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-rt-'));
  process.env.UPLOADS_DIR = uploadsRoot;
  fs.mkdirSync(path.join(uploadsRoot, 'images'), { recursive: true });
  fs.mkdirSync(path.join(uploadsRoot, 'files'), { recursive: true });
  return uploadsRoot;
}
function teardownUploads() {
  fs.rmSync(uploadsRoot, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
}

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  delete require.cache[require.resolve('../config/paths')];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

function leanChain(docs) {
  return {
    select: () => leanChain(docs),
    sort: () => leanChain(docs),
    lean: async () => docs,
    then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject)
  };
}

/** Note-Mock: find/findOne liefern den Bestand, insertMany schneidet mit. */
function modelOver({ notes = [], inserted = [] } = {}) {
  return {
    inserted,
    find: (query) => leanChain(notes),
    findOne: () => leanChain(null),
    countDocuments: async () => notes.length,
    insertMany: async (docs) => {
      inserted.push(...docs);
      return docs;
    }
  };
}

function noteFixture(overrides = {}) {
  return {
    _id: new (require('mongoose').Types.ObjectId)(),
    parentId: null,
    title: 'Titel',
    content: 'Inhalt',
    isTodoList: false,
    todoItems: [],
    tags: [],
    isCode: false,
    order: 0,
    isArchived: false,
    isPinned: false,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-02T10:00:00.000Z'),
    color: '#ffffff',
    remindAt: null,
    images: [],
    files: [],
    ...overrides
  };
}

test('Export schreibt Frontmatter, Assets und Manifest; Import stellt alles wieder her', async () => {
  const root = setupUploads();
  try {
    const imageFilename = 'img-aabbcc.png';
    const fileFilename = 'doc-112233.pdf';
    fs.writeFileSync(path.join(root, 'images', imageFilename), TINY_PNG);
    fs.writeFileSync(path.join(root, 'files', fileFilename), Buffer.from('%PDF-1.4 round-trip-payload'));

    const notes = [
      noteFixture({
        title: 'Rezepte: Desserts!',
        content: `Siehe Bild:\n/uploads/images/${imageFilename}\nund PDF: /uploads/files/${fileFilename}`,
        tags: ['kochen', 'süß'],
        isPinned: true,
        color: '#aecbfa',
        remindAt: new Date('2026-10-01T08:00:00.000Z'),
        images: [{ url: `/uploads/images/${imageFilename}`, filename: imageFilename }],
        files: [{ filename: fileFilename, originalName: 'Mein Rezeptband.pdf', mimetype: 'application/pdf' }]
      }),
      noteFixture({
        title: 'Einkaufsliste Kind',
        parentId: null,
        isTodoList: true,
        todoItems: [
          { text: 'Milch', completed: false, order: 0 },
          { text: 'Zucker', completed: true, order: 1 }
        ],
        updatedAt: new Date('2026-09-03T10:00:00.000Z')
      })
    ];
    notes[1].parentId = notes[0]._id; // Kind unter der ersten Notiz

    const exportModel = modelOver({ notes });
    const exporter = loadService(exportModel);
    const archive = await exporter.buildMarkdownExport(USER);

    // --- Export-Seite pruefen (am echten Archiv, nicht am Mock) ---
    const entries = readZipEntries(archive);
    const names = [...entries.keys()];
    assert.ok(names.some((n) => n.endsWith('.md') && n.includes('_index.md')), 'Ordner-Notiz als _index.md');
    assert.ok(names.includes(`assets/images/${imageFilename}`), 'Originalbild reist mit');
    assert.ok(names.includes(`assets/files/${fileFilename}`), 'PDF reist mit');
    const manifest = JSON.parse(entries.get('assets/manifest.json').toString('utf8'));
    assert.equal(manifest[`assets/files/${fileFilename}`].originalName, 'Mein Rezeptband.pdf');
    assert.equal(manifest[`assets/files/${fileFilename}`].mimetype, 'application/pdf');
    const indexMd = entries.get(names.find((n) => n.endsWith('_index.md'))).toString('utf8');
    assert.match(indexMd, /^---\n/);
    assert.match(indexMd, /title: 'Rezepte: Desserts!'/, 'Sonderlagen im Titel werden YAML-quoted');
    assert.match(indexMd, /pinned: true/);
    assert.match(indexMd, /color: '#aecbfa'/, '# leitet sonst einen YAML-Kommentar ein');
    assert.match(indexMd, /remindAt: '2026-10-01T08:00:00.000Z'/);
    assert.match(indexMd, /created: '2026-09-01T10:00:00.000Z'/);
    assert.match(indexMd, /tags: \[kochen, 'süß'\]/, 'Nicht-ASCII-Tags werden quoted');
    assert.ok(indexMd.includes(`assets/images/${imageFilename}`), 'Bild-Referenz relativ umgeschrieben');

    // --- Import-Seite: dasselbe Archiv zurueck in eine "leere" Bibliothek ---
    const importModel = modelOver({});
    const importer = loadService(importModel);
    const result = await importer.importMarkdownZip(USER, archive);

    assert.equal(result.foldersCreated, 1, 'der Ordner (mit _index verschmolzen) wird angelegt');
    assert.equal(result.created, 1, 'nur das Kind wird zusaetzliche Notiz — kein _index-Duplikat');

    const folder = importModel.inserted.find((doc) => doc.title === 'Rezepte: Desserts!');
    assert.ok(folder, 'Frontmatter-Titel gewinnt ueber den sanitizten Dateinamen');
    assert.equal(folder.isPinned, true);
    assert.equal(folder.color, '#aecbfa');
    assert.deepEqual(folder.tags.sort(), ['kochen', 'süß']);
    assert.equal(new Date(folder.remindAt).toISOString(), '2026-10-01T08:00:00.000Z');
    assert.equal(new Date(folder.createdAt).toISOString(), '2026-09-01T10:00:00.000Z');
    assert.equal(folder.images.length, 1, 'nur referenzierte Anhaenge haengen an');
    assert.notEqual(folder.images[0].filename, imageFilename, 'frischer Zufallsname, kein Ueberschreiben');
    assert.ok(fs.existsSync(path.join(root, 'images', folder.images[0].filename)), 'Bilddatei liegt auf der Platte');
    assert.ok(
      fs.existsSync(path.join(root, 'images', folder.images[0].thumbnailFilename)),
      'Thumbnail wurde frisch generiert'
    );
    assert.ok(folder.content.includes(folder.images[0].url), 'Inhalt referenziert die NEUE Server-URL');

    assert.equal(folder.files.length, 1);
    assert.equal(folder.files[0].originalName, 'Mein Rezeptband.pdf', 'originalName aus dem Manifest');
    assert.equal(folder.files[0].mimetype, 'application/pdf');
    assert.ok(fs.existsSync(path.join(root, 'files', folder.files[0].filename)));

    const todo = importModel.inserted.find((doc) => doc.title === 'Einkaufsliste Kind');
    assert.ok(todo, 'Kind-Notiz angelegt');
    assert.equal(todo.isTodoList, true, 'Todo-Flag reist im Frontmatter');
    assert.equal(todo.content, '', 'Todo-Body wird wieder zur Struktur');
    assert.deepEqual(
      todo.todoItems.map((i) => [i.text, i.completed]),
      [['Milch', false], ['Zucker', true]]
    );
    assert.equal(String(todo.parentId), String(folder._id), 'Kind haengt am (verschmolzenen) Ordnerknoten');
  } finally {
    teardownUploads();
  }
});

test('Frontmatter-Parser: quoted Strings, Arrays, fehlender Block', () => {
  const service = loadService(modelOver({}));
  const parsed = service.parseMarkdownFrontmatter(
    "---\ntitle: 'Ein: Titel'\ntags: [a, 'b b', \"c-c\"]\npinned: true\nremindAt: '2026-10-01T08:00:00.000Z'\nbad-line ohne Doppelpunkt\n---\n\nKoerper"
  );
  assert.equal(parsed.meta.title, 'Ein: Titel');
  assert.deepEqual(parsed.meta.tags, ['a', 'b b', 'c-c']);
  assert.equal(parsed.meta.pinned, 'true');
  assert.equal(parsed.body, '\nKoerper');

  const none = service.parseMarkdownFrontmatter('# Nur Markdown');
  assert.deepEqual(none.meta, {});
  assert.equal(none.body, '# Nur Markdown');

  const empty = service.parseMarkdownFrontmatter('---\ntitle: leeer\n---');
  assert.equal(empty.meta.title, 'leeer');
  assert.equal(empty.body, '');
});

test('Import weist kaputte und md-lose ZIPs als Client-Fehler ab', async () => {
  const root = setupUploads();
  try {
    const service = loadService(modelOver({}));
    await assert.rejects(
      () => service.importMarkdownZip(USER, Buffer.from('definitiv kein zip')),
      (error) => error.statusCode === 400 && /Archiv/.test(error.message)
    );

    // Gueltiges ZIP ohne Markdown: python-zipfile-artig ueber den eigenen Writer bauen
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('nur-eine-binärdatei.bin', Buffer.from([1, 2, 3]));
    await assert.rejects(
      () => service.importMarkdownZip(USER, zip.finish()),
      (error) => error.statusCode === 400 && /keine Markdown-Dateien/.test(error.message)
    );
  } finally {
    teardownUploads();
  }
});

test('Route und Upload-Middleware melden den ZIP-Import an', () => {
  const routes = fs.readFileSync(require.resolve('../routes/notes.js'), 'utf8');
  const zipRoute = routes.indexOf("router.post('/import/markdown-zip'");
  const plainId = routes.indexOf("router.get('/:id'");
  assert.ok(zipRoute > -1 && zipRoute < plainId, '/import/markdown-zip muss vor /:id registriert sein');
  assert.match(routes, /uploadZip\.single\('archive'\)/);

  const upload = fs.readFileSync(require.resolve('../middleware/upload.js'), 'utf8');
  assert.match(upload, /Nur ZIP-Archive sind erlaubt/);
  assert.match(upload, /512 \* 1024 \* 1024/);
});

// ---------------------------------------------------------------------------
// v1.14.0 Nr. 2 — ZIP-Import-Härtung (Stored XSS): Bild-Eintraege bekamen ihre
// Endung vom Archiv-Autor gewaehlt und wurden ohne Magic-Byte-Pruefung nach
// uploads/images geschrieben; secureFileServe stellt per sendFile nach Endung
// aus — ein .html/.svg-Eintrag lief im Browserkontext des Nutzers.
// ---------------------------------------------------------------------------

test('ZIP-Import lehnt Bild-Anhänge mit verbotener Endung komplett ab', async () => {
  const root = setupUploads();
  try {
    const inserted = [];
    const service = loadService(modelOver({ inserted }));
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    zip.add('assets/images/boese.html', Buffer.from('<script>alert(document.domain)</script>'));
    zip.add('notiz.md', Buffer.from('# Hallo\n\nText'));

    await assert.rejects(
      () => service.importMarkdownZip(USER, zip.finish()),
      /keine erlaubte Bild-Endung/
    );
    assert.equal(fs.readdirSync(path.join(root, 'images')).length, 0, 'keine Datei bleibt zurück');
    assert.equal(fs.readdirSync(path.join(root, 'files')).length, 0, 'auch files/ bleibt leer');
    assert.equal(inserted.length, 0, 'angelegt wurde nichts — alles oder nichts');
  } finally {
    teardownUploads();
  }
});

test('ZIP-Import prüft Magic Bytes: .png mit HTML-Inhalt fliegt raus', async () => {
  const root = setupUploads();
  try {
    const inserted = [];
    const service = loadService(modelOver({ inserted }));
    const { ZipWriter } = require('../utils/zipWriter');
    const zip = new ZipWriter();
    // Erlaubte Endung, aber der Inhalt ist kein Bild — genau der Fall, den der
    // Multipart-Upload schon abwehrt (validateImageFiles) und der ZIP-Import
    // bis v1.13.0 durchliess.
    zip.add('assets/images/fake.png', Buffer.from('<!DOCTYPE html><html><body>kein PNG</body></html>'));
    zip.add('notiz.md', Buffer.from('# Hallo\n\nText'));

    await assert.rejects(
      () => service.importMarkdownZip(USER, zip.finish()),
      /Magic-Bytes/
    );
    assert.equal(fs.readdirSync(path.join(root, 'images')).length, 0, 'die abgelehnte Datei wird wieder entfernt');
    assert.equal(inserted.length, 0);
  } finally {
    teardownUploads();
  }
});
