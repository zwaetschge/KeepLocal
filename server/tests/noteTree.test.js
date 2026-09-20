const test = require('node:test');
const assert = require('node:assert/strict');

// Baum-System (v1.10.0): parentId auf Notizen, Zyklus-Schutz, Kinder-Reparenting
// beim Löschen, GET /api/notes/tree als leichte Übersicht, Markdown-ZIP-Export
// und die drei neuen Preference-Felder (tagColors, savedSearches, journalFolderId).
//
// Gleiches Mock-Muster wie noteTrash.test.js: Das Note-Modul wird per
// require.cache-Injection ersetzt, der Service darueber geladen.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

const OWNER_ID = '507f191e810c19729de860ea';
const OTHER_ID = '507f191e810c19729de860eb';

function loadService(NoteMock) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: {} };
  return require(servicePath);
}

/** Mini-Notizen-Speicher mit den fuer den Service noetigen Mongoose-Methoden. */
function makeNoteStore(initial) {
  const docs = new Map(initial.map((note) => [String(note._id), { ...note }]));
  const constructCalls = [];

  const store = {
    docs,
    constructCalls,
    updates: [],
    save(note) {
      docs.set(String(note._id), note);
    }
  };

  const findOne = (query) => {
    for (const doc of docs.values()) {
      if (query._id !== undefined && String(doc._id) !== String(query._id)) continue;
      if (query.userId !== undefined && String(doc.userId) !== String(query.userId)) continue;
      if (query.deletedAt === null && doc.deletedAt != null) continue;
      if (query.deletedAt !== undefined && query.deletedAt !== null && query.deletedAt.ne !== null) {
        if (doc.deletedAt == null) continue;
      }
      return { ...doc };
    }
    return null;
  };

  // Mongoose-Query-Nachahmung: updateNote awaited findOne() direkt,
  // assertValidParent haengt .lean() dran — beides muss funktionieren.
  const leanable = (doc) => {
    const wrapper = {
      lean: () => wrapper,
      populate: () => wrapper,
      then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
    };
    return wrapper;
  };

  store.NoteMock = {
    find: (query) => {
      const matches = [...docs.values()].filter((doc) => {
        if (String(doc.userId) !== String(query.userId)) return false;
        if (query.deletedAt === null && doc.deletedAt != null) return false;
        if (query.deletedAt && query.deletedAt.$ne === null && doc.deletedAt == null) return false;
        return true;
      });
      return {
        select() { return this; },
        sort() { return this; },
        lean: async () => matches
      };
    },
    findOne: (query) => leanable(findOne(query)),
    updateMany: async (query, update) => {
      let modified = 0;
      for (const doc of docs.values()) {
        if (String(doc.userId) !== String(query.userId)) continue;
        if (String(doc.parentId) !== String(query.parentId)) continue;
        if (doc.deletedAt != null) continue;
        doc.parentId = update.$set.parentId ?? null;
        modified++;
      }
      store.updates.push({ query, update, modified });
      return { modifiedCount: modified };
    },
    deleteMany: async () => ({ deletedCount: 0 })
  };
  store.findOne = findOne;
  return store;
}

test('updateNote weist Zyklus ab: Notiz unter ihr eigenes Kind', async () => {
  const store = makeNoteStore([
    { _id: 'a'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, updatedAt: new Date() },
    { _id: 'b'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: 'a'.repeat(24), updatedAt: new Date() }
  ]);
  const service = loadService(store.NoteMock);

  await assert.rejects(
    () => service.updateNote('a'.repeat(24), { parentId: 'b'.repeat(24) }, OWNER_ID),
    /unter sich selbst/
  );
});

test('updateNote weist Selbst-Referenz und fremde Eltern ab', async () => {
  const store = makeNoteStore([
    { _id: 'a'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, updatedAt: new Date() },
    { _id: 'c'.repeat(24), userId: OTHER_ID, deletedAt: null, parentId: null, updatedAt: new Date() }
  ]);
  const service = loadService(store.NoteMock);

  await assert.rejects(
    () => service.updateNote('a'.repeat(24), { parentId: 'a'.repeat(24) }, OWNER_ID),
    /unter sich selbst/
  );
  await assert.rejects(
    () => service.updateNote('a'.repeat(24), { parentId: 'c'.repeat(24) }, OWNER_ID),
    /nicht gefunden/
  );
});

test('updateNote akzeptiert gueltigen Zug und setzt parentId/isCode', async () => {
  const noteId = 'a'.repeat(24);
  const parentId = 'b'.repeat(24);
  const store = makeNoteStore([
    { _id: noteId, userId: OWNER_ID, deletedAt: null, parentId: null, updatedAt: new Date(), isCode: false, content: 'Text' },
    { _id: parentId, userId: OWNER_ID, deletedAt: null, parentId: null, updatedAt: new Date(), isCode: false, content: 'Text' }
  ]);
  let captured = null;
  store.NoteMock.findOneAndUpdate = async (query, update) => {
    captured = update;
    return { _id: query._id };
  };
  const service = loadService(store.NoteMock);

  await service.updateNote(noteId, { parentId, isCode: true }, OWNER_ID);
  assert.equal(captured.$set.parentId, parentId);
  assert.equal(captured.$set.isCode, true);
});

test('validateNoteFields lehnt kaputte parentId ab, laesst null/isCode zu', async () => {
  const service = loadService(makeNoteStore([]).NoteMock);
  assert.throws(() => service.validateNoteFields({ parentId: 'xyz' }), /parentId/);
  assert.throws(() => service.validateNoteFields({ parentId: 42 }), /parentId/);
  assert.throws(() => service.validateNoteFields({ isCode: 'ja' }), /isCode/);
  service.validateNoteFields({ parentId: null, isCode: false });
  service.validateNoteFields({});
});

test('getNoteTree liefert leichte Projektion ohne Inhalte', async () => {
  const store = makeNoteStore([
    { _id: 'a'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Wurzel', order: 3, isPinned: true, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'GEHEIM' },
    { _id: 'b'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: 'a'.repeat(24), title: 'Kind', order: 0, isPinned: false, isCode: true, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date() },
    { _id: 't'.repeat(24), userId: OWNER_ID, deletedAt: new Date(), parentId: null, title: 'Papierkorb', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date() }
  ]);
  const service = loadService(store.NoteMock);
  const tree = await service.getNoteTree(OWNER_ID);

  assert.equal(tree.length, 2, 'Papierkorb-Notiz fehlt');
  assert.equal(tree[0].id, 'a'.repeat(24));
  assert.equal(tree[1].parentId, 'a'.repeat(24));
  assert.ok(!('content' in tree[0]), 'Inhalt darf nicht mitreisen');
  assert.ok(!('images' in tree[0]));
  assert.equal(tree[1].isCode, true);
});

test('deleteNote zieht Kinder eine Ebene hoch', async () => {
  const grandParent = 'g'.repeat(24);
  const parent = 'p'.repeat(24);
  const child = 'c'.repeat(24);
  const store = makeNoteStore([
    { _id: grandParent, userId: OWNER_ID, deletedAt: null, parentId: null, updatedAt: new Date() },
    { _id: parent, userId: OWNER_ID, deletedAt: null, parentId: grandParent, updatedAt: new Date() },
    { _id: child, userId: OWNER_ID, deletedAt: null, parentId: parent, updatedAt: new Date() }
  ]);
  store.NoteMock.findOneAndUpdate = async (query, update) => {
    const doc = store.docs.get(String(query._id));
    Object.assign(doc, update.$set);
    return { ...doc };
  };
  const service = loadService(store.NoteMock);

  await service.deleteNote(parent, OWNER_ID);
  const reparented = store.docs.get(child);
  assert.equal(String(reparented.parentId), grandParent, 'Kind haengt jetzt am Grosselternteil');
});

test('buildMarkdownExport erzeugt ZIP mit Ordnerstruktur und _index.md', async () => {
  const store = makeNoteStore([
    { _id: 'f'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Projekte', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'Ordnerinhalt', tags: ['arbeit'] },
    { _id: 'k'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: 'f'.repeat(24), title: 'Idee', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'Erste Zeile' },
    { _id: 'z'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Einzeln', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'Solo' }
  ]);
  const service = loadService(store.NoteMock);
  const zipBuffer = await service.buildMarkdownExport(OWNER_ID);

  assert.ok(Buffer.isBuffer(zipBuffer));
  assert.equal(zipBuffer.readUInt32LE(0), 0x04034b50, 'Local-File-Header-Signature');
  const eocdOffset = zipBuffer.length - 22;
  assert.equal(zipBuffer.readUInt32LE(eocdOffset), 0x06054b50, 'EOCD-Signature');
  assert.equal(zipBuffer.readUInt16LE(eocdOffset + 10), 3, 'drei Eintraege: Ordner-_index, Kind, Solo');

  const asText = zipBuffer.toString('latin1');
  assert.ok(asText.includes('Projekte/_index.md'), 'Ordner-Index vorhanden');
  assert.ok(asText.includes('Idee.md'), 'Kind als Datei');
  assert.ok(asText.includes('Einzeln.md'), 'Wurzel-Notiz als Datei');
  assert.ok(zipBuffer.toString('utf8').includes('# Projekte'), 'Markdown-Ueberschrift');
  assert.ok(zipBuffer.toString('utf8').includes('#arbeit'), 'Tags als Hashtags');
});

test('Markdown-Export: zwei gleiche Titel kollidieren nicht', async () => {
  const store = makeNoteStore([
    { _id: 'a1'.padEnd(24, '0'), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Notiz', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: '1' },
    { _id: 'a2'.padEnd(24, '0'), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Notiz', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: '2' }
  ]);
  const service = loadService(store.NoteMock);
  const zipBuffer = await service.buildMarkdownExport(OWNER_ID);
  const text = zipBuffer.toString('latin1');
  assert.ok(text.includes('Notiz.md'));
  assert.ok(text.includes('Notiz-2.md'), 'zweiter Name angehaengt');
});

test('ZipWriter CRC32 kennt die Referenzwerte', () => {
  const { crc32 } = require('../utils/zipWriter');
  assert.equal(crc32(Buffer.from('')), 0x00000000);
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('Leere Bibliothek liefert ein gueltiges, leeres ZIP', async () => {
  const store = makeNoteStore([]);
  const service = loadService(store.NoteMock);
  const zipBuffer = await service.buildMarkdownExport(OWNER_ID);
  assert.equal(zipBuffer.readUInt32LE(zipBuffer.length - 22), 0x06054b50);
  assert.equal(zipBuffer.readUInt16LE(zipBuffer.length - 22 + 10), 0);
});

// ---------------------------------------------------------------------------
// HTTP level: Routen-Reihenfolge und Contracts
// ---------------------------------------------------------------------------

const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/notes');

function loadRouter(serviceMock) {
  for (const p of [routerPath, servicePath, authPath]) delete require.cache[p];
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: serviceMock };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: { authenticateToken: (req, _res, next) => { req.user = { _id: OWNER_ID, isDemo: false }; next(); } }
  };
  return require(routerPath);
}

async function withServer(router, run) {
  const express = require('express');
  const http = require('node:http');
  const app = express();
  app.use(express.json());
  app.use('/api/notes', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/notes`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [routerPath, servicePath, authPath]) delete require.cache[p];
  }
}

test('GET /api/notes/tree antwortet mit der Leicht-Projektion, nicht als :id', async () => {
  const calls = [];
  const router = loadRouter({
    getNoteTree: async (userId) => { calls.push(['tree', userId]); return [{ id: 'a'.repeat(24), parentId: null, title: 'Wurzel' }]; },
    getNoteById: async () => { throw new Error('tree darf nicht als Notiz-ID geroutet werden'); }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/tree`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [{ id: 'a'.repeat(24), parentId: null, title: 'Wurzel' }]);
    assert.deepEqual(calls, [['tree', OWNER_ID]]);
  });
});

test('GET /api/notes/export/markdown streamt ein ZIP als Anhang', async () => {
  const { ZipWriter } = require('../utils/zipWriter');
  const zip = new ZipWriter();
  zip.add('Demo.md', '# Demo\n');
  const archive = zip.finish();
  const calls = [];
  const router = loadRouter({
    buildMarkdownExport: async (userId) => { calls.push(userId); return archive; }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/export/markdown`);
    const buffer = Buffer.from(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition') || '', /keeplocal-export\.zip/);
    assert.equal(buffer.readUInt32LE(0), 0x04034b50, 'PK-Signatur am Anfang');
    assert.deepEqual(calls, [OWNER_ID]);
  });
});

// v1.10.1 defensive: Der Export darf Notizen, die von der Wurzel aus
// unerreichbar sind (Eltern geloescht, Zyklus in der DB), nicht still
// verschlucken und nicht in eine Endlos-Rekursion laufen.
test('buildMarkdownExport gibt Waisen und Zyklus-Knoten an der Wurzel aus', async () => {
  const orphanParent = 'o'.repeat(24); // existiert NICHT im Bestand
  const store = makeNoteStore([
    { _id: 'x'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: orphanParent, title: 'Waise', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'Verwaist' },
    // Zyklus A -> B -> A: kein Knoten haengt an der Wurzel
    { _id: 'a'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: 'b'.repeat(24), title: 'ZyklusA', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'A' },
    { _id: 'b'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: 'a'.repeat(24), title: 'ZyklusB', order: 0, isPinned: false, isCode: false, isArchived: false, isTodoList: false, remindAt: null, updatedAt: new Date(), content: 'B' }
  ]);
  const service = loadService(store.NoteMock);

  const zipBuffer = await service.buildMarkdownExport(OWNER_ID);
  const asText = zipBuffer.toString('latin1');

  assert.ok(asText.includes('Waise.md'), 'Waise landet an der Wurzel statt zu fehlen');
  assert.ok(asText.includes('ZyklusA') && asText.includes('ZyklusB'), 'Zyklus-Knoten werden je einmal ausgegeben');
  // Zyklus: A als _index-Ordner (hat Kind B) + B als Datei — kein Doppeltaverse.
  assert.ok(!asText.includes('ZyklusA.md'), 'A wird nur als Ordner-_index geschrieben');
});
