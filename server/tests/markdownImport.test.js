const test = require('node:test');
const assert = require('node:assert/strict');

// Bulk-Import (v1.10.1): POST /api/notes/import/markdown ersetzt die
// Create-Request pro Datei. Service-Level-Tests mit demselben Mock-Muster wie
// noteTree.test.js (require.cache-Injection des Note-Moduls).

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

const OWNER_ID = '507f191e810c19729de860ea';

function loadService(NoteMock) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: {} };
  return require(servicePath);
}

/**
 * Minimal-Store: find/countDocuments/insertMany reichen fuer den Import-Pfad;
 * findOne bedient nur die nextTopOrder-Abfrage (hoechstes order > 0).
 */
function makeStore(initial = []) {
  const docs = new Map(initial.map((note) => [String(note._id), { ...note }]));
  const inserted = [];

  const visible = () => [...docs.values()].filter((doc) =>
    String(doc.userId) === String(OWNER_ID) && doc.deletedAt == null);

  const NoteMock = {
    find: () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => visible().map((doc) => ({ _id: doc._id, parentId: doc.parentId ?? null, title: doc.title }))
    }),
    findOne: (query) => {
      if (String(query.userId) !== String(OWNER_ID)) return null;
      if (query.order === undefined || !query.order || query.order.$gt === undefined) return null;
      if (query.isPinned !== false || query.isArchived !== false) return null;
      const candidates = visible()
        .filter((doc) => doc.isPinned === false && doc.isArchived === false && typeof doc.order === 'number' && doc.order > 0)
        .sort((a, b) => b.order - a.order);
      const top = candidates[0];
      return {
        select() { return this; },
        sort() { return this; },
        lean() { return this; },
        then: (resolve) => resolve(top ? { order: top.order } : null)
      };
    },
    countDocuments: async () => visible().length,
    insertMany: async (batch) => {
      for (const doc of batch) {
        docs.set(String(doc._id), doc);
        inserted.push(doc);
      }
      return batch;
    }
  };
  return { docs, inserted, NoteMock };
}

test('importMarkdownNotes legt Ordner elternzuerst und Notizen mit parentId an', async () => {
  const store = makeStore([
    { _id: 'e'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Bestand', isPinned: false, isArchived: false, order: 5 }
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.importMarkdownNotes(OWNER_ID, [
    { path: 'Projekte/KeepLocal', title: 'Roadmap', content: '# Roadmap' },
    { path: 'Projekte/KeepLocal', title: 'Bugs', content: '' },
    { path: '', title: 'lose Notiz', content: 'Solo' }
  ]);

  assert.equal(result.created, 3);
  assert.equal(result.foldersCreated, 2, 'Projekte + KeepLocal');
  assert.equal(store.inserted.length, 5, '2 Ordner + 3 Notizen');

  const projekte = store.inserted.find((doc) => doc.title === 'Projekte');
  const keeplocal = store.inserted.find((doc) => doc.title === 'KeepLocal');
  assert.equal(projekte.parentId, null);
  assert.equal(String(keeplocal.parentId), String(projekte._id), 'Eltern vor Kindern angelegt');

  const roadmap = store.inserted.find((doc) => doc.title === 'Roadmap');
  assert.equal(String(roadmap.parentId), String(keeplocal._id));
  assert.equal(roadmap.order, 6, 'erste Notiz auf naechster Top-Order-Position (max 5 + 1)');

  const solo = store.inserted.find((doc) => doc.title === 'lose Notiz');
  assert.equal(solo.parentId, null);
  assert.equal(solo.order, 8, 'order steigt in Datei-Reihenfolge');
});

test('importMarkdownNotes verwendet bestehende Ordner-Knoten wieder', async () => {
  const existingFolderId = 'f'.repeat(24);
  const store = makeStore([
    { _id: existingFolderId, userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Projekte', isPinned: false, isArchived: false, order: 1 }
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.importMarkdownNotes(OWNER_ID, [
    { path: 'Projekte', title: 'Neu im Existing', content: 'x' }
  ]);

  assert.equal(result.foldersCreated, 0, 'kein Duplikat-Ordner');
  assert.equal(store.inserted.length, 1);
  assert.equal(String(store.inserted[0].parentId), existingFolderId);
});

test('importMarkdownNotes validiert VOR dem Schreiben: nichts halb angelegt', async () => {
  const store = makeStore();
  const service = loadService(store.NoteMock);

  await assert.rejects(
    () => service.importMarkdownNotes(OWNER_ID, []),
    /items/
  );
  await assert.rejects(
    () => service.importMarkdownNotes(OWNER_ID, [{ path: 'a/b', title: 'ok', content: 'x' }, { path: 'x'.repeat(401) }]),
    /path/
  );
  const tooDeep = 'seg/'.repeat(21).replace(/\/$/, '');
  await assert.rejects(
    () => service.importMarkdownNotes(OWNER_ID, [{ path: tooDeep, title: 'deep', content: '' }]),
    /Ebenen/
  );
  await assert.rejects(
    () => service.importMarkdownNotes(OWNER_ID, [{ path: 'a', title: 't', content: 'x'.repeat(10001) }]),
    /10.000/
  );
  await assert.rejects(
    () => service.importMarkdownNotes(OWNER_ID, Array.from({ length: 501 }, (_, i) => ({ title: `n${i}` }))),
    /500/
  );

  assert.equal(store.inserted.length, 0, 'bei Validierungsfehler wird nichts angelegt');
});

test('importMarkdownNotes haelt das Demo-Budget ein (Bestand + Chunk)', async () => {
  const store = makeStore([
    { _id: '1'.repeat(24), userId: OWNER_ID, deletedAt: null, parentId: null, title: 'Bestand', isPinned: false, isArchived: false, order: 1 }
  ]);
  const service = loadService(store.NoteMock);

  await assert.rejects(
    () => service.importMarkdownNotes(OWNER_ID, [
      { path: 'Neu', title: 'a', content: '' },
      { path: 'Neu', title: 'b', content: '' }
    ], { demoLimit: 2 }),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.code, 'DEMO_NOTE_LIMIT');
      return true;
    }
  );
  assert.equal(store.inserted.length, 0, 'ueber Budget: kein Teil-Import');

  // Bestand 1 + Ordner 1 + Notiz 1 = 3 > Limit 3? Nein: 3 <= 3 ist erlaubt.
  const ok = await service.importMarkdownNotes(OWNER_ID, [
    { path: 'Neu', title: 'a', content: '' }
  ], { demoLimit: 3 });
  assert.equal(ok.created, 1);
  assert.equal(ok.foldersCreated, 1);
});

test('importMarkdownNotes normalisiert Titel/Tags/Pfade defensiv', async () => {
  const store = makeStore();
  const service = loadService(store.NoteMock);

  const result = await service.importMarkdownNotes(OWNER_ID, [
    { path: '/Projekte/', title: '  ', content: 'x', tags: ['  Arbeit ', '', 'x'.repeat(80)] }
  ]);

  assert.equal(result.created, 1);
  const note = store.inserted.find((doc) => doc.content === 'x');
  assert.equal(note.title, 'Notiz', 'leerer Titel faellt auf den Fallback');
  // Trimmen/Filtern/Kappen macht der Service; das Lowercase uebernimmt erst das
  // Mongoose-Schema (transform), das der Mock hier nicht nachbildet.
  assert.deepEqual(note.tags, ['Arbeit', 'x'.repeat(50)], 'getrimmt, leere gefiltert, auf 50 gekappt');
  assert.ok(note.parentId, 'Pfad-Slashes am Rand sind entfernt, Ordner angelegt');
});
