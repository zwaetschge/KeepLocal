const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const uploadsDir = path.resolve(__dirname, '../uploads/images');

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

test('purging a trashed note keeps image files when the database deletion fails', async () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `delete-order-${process.pid}.png`;
  const filepath = path.join(uploadsDir, filename);
  fs.writeFileSync(filepath, 'test');

  const note = { images: [{ filename }] };
  const NoteMock = {
    findOne: async () => note,
    findOneAndDelete: async () => {
      throw new Error('database unavailable');
    }
  };
  const service = loadService(NoteMock);

  try {
    await assert.rejects(service.purgeNote('note-id', 'user-id'), /database unavailable/);
    assert.equal(fs.existsSync(filepath), true);
  } finally {
    fs.rmSync(filepath, { force: true });
  }
});

test('deleting a note moves it to the trash without touching image files', async () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `soft-delete-${process.pid}.png`;
  const filepath = path.join(uploadsDir, filename);
  fs.writeFileSync(filepath, 'test');

  let update = null;
  const NoteMock = {
    findOneAndUpdate: async (_query, change) => {
      update = change;
      return { images: [{ filename }], ...change.$set };
    },
    findOneAndDelete: async () => {
      throw new Error('a soft delete must never remove the document');
    },
    // Baum (v1.10.0): Loeschen zieht Kinder eine Ebene hoch.
    updateMany: async () => ({ modifiedCount: 0 })
  };
  const service = loadService(NoteMock);

  try {
    const deleted = await service.deleteNote('note-id', 'user-id');
    assert.ok(update.$set.deletedAt instanceof Date);
    assert.equal(deleted.deletedAt instanceof Date, true);
    assert.equal(fs.existsSync(filepath), true, 'files stay until the note is purged');
  } finally {
    fs.rmSync(filepath, { force: true });
  }
});

test('note pagination clamps invalid public API values', async () => {
  const observed = {};
  const query = {
    populate() { return this; },
    select() { return this; },
    sort() { return this; },
    skip(value) { observed.skip = value; return this; },
    limit(value) { observed.limit = value; return Promise.resolve([]); }
  };
  const NoteMock = {
    countDocuments: async () => 0,
    find: () => query,
    aggregate: async () => []
  };
  const service = loadService(NoteMock);

  const result = await service.getAllNotes({
    userId: 'user-id',
    page: '-5',
    limit: '100000',
    archived: 'unexpected'
  });

  assert.equal(observed.skip, 0);
  assert.equal(observed.limit, 100);
  assert.deepEqual(result.pagination, { page: 1, limit: 100, total: 0, pages: 0 });
});

// Ordner-Scope (v1.11.1): GET /api/notes?folderId= filtert serverseitig —
// der Client filterte vorher nur das geladene 50er-Fenster und zeigte Ordner
// ab ein paar hundert Notizen leer. Der Mock fängt alle Queries ab.
function makeScopeMock() {
  const observed = { counts: [], finds: [], aggregate: null };
  const query = {
    populate() { return this; },
    select() { return this; },
    sort() { return this; },
    skip(value) { observed.skip = value; return this; },
    limit(value) { observed.limit = value; return Promise.resolve([]); }
  };
  const NoteMock = {
    countDocuments: async (q) => { observed.counts.push(q); return 0; },
    find: (q) => { observed.finds.push(q); return query; },
    aggregate: async (pipeline) => { observed.aggregate = pipeline[0].$match; return []; }
  };
  return { observed, service: loadService(NoteMock) };
}

test('folderId=root scopes list and total to top level, counts stay global', async () => {
  const { observed, service } = makeScopeMock();

  await service.getAllNotes({ userId: 'user-id', folderId: 'root' });

  assert.equal(observed.finds.length, 1);
  assert.equal(observed.finds[0].parentId, null, 'Liste auf Hauptebene begrenzt');
  assert.equal(observed.counts[0].parentId, null, 'total zählt den Scope mit');
  for (const globalQuery of observed.counts.slice(1)) {
    assert.equal('parentId' in globalQuery, false, 'active/archived/trash-Zähler bleiben global');
  }
  assert.equal('parentId' in observed.aggregate, false, 'Tag-Cloud bleibt global');
});

test('folderId with a note id scopes to the direct children of that node', async () => {
  const { observed, service } = makeScopeMock();
  const folderId = 'a'.repeat(24);

  await service.getAllNotes({ userId: 'user-id', folderId });

  assert.equal(observed.finds[0].parentId, folderId);
  assert.equal(observed.counts[0].parentId, folderId);
});

test('folderId without scope leaves the query untouched, garbage rejects as client error', async () => {
  const { observed, service } = makeScopeMock();
  await service.getAllNotes({ userId: 'user-id' });
  for (const q of [...observed.finds, ...observed.counts]) {
    assert.equal('parentId' in q, false, 'ohne folderId kein Filter');
  }

  await assert.rejects(
    service.getAllNotes({ userId: 'user-id', folderId: 'not-an-id' }),
    error => error.statusCode === 400
  );
});

test('empty notes fail with a client error before reaching MongoDB', async () => {
  class NoteMock {
    async save() {
      throw new Error('save should not run');
    }
  }
  const service = loadService(NoteMock);

  await assert.rejects(
    service.createNote({ content: '', isTodoList: false }, 'user-id'),
    error => error.statusCode === 400 && error.message === 'Inhalt ist erforderlich'
  );
});

// Delta-Sync (v1.13.0): GET /api/notes?since=ISO filtert Liste+Total auf
// geänderte Dokumente; Counts und Tag-Cloud bleiben global.
test('since scopes list and pagination total, counts stay global', async () => {
  const { observed, service } = makeScopeMock();
  const since = '2026-09-21T00:00:00.000Z';

  await service.getAllNotes({ userId: 'user-id', since });

  // $gte (Review v1.14.0): updatedAt hat ms-Auflösung, Bulk-Ops schreiben
  // vielen Notizen denselben Timestamp — ein striktes $gt hätte eine im
  // selben Tick wie der Cursor geänderte Notiz dauerhaft übersprungen.
  assert.equal(observed.finds[0].updatedAt.$gte instanceof Date, true, 'Liste auf Änderungen begrenzt (inklusive Grenze)');
  assert.equal(observed.finds[0].updatedAt.$gte.toISOString(), since);
  assert.equal(observed.counts[0].updatedAt.$gte instanceof Date, true, 'Pagination-Total zählt den Delta-Scope');
  for (const globalQuery of observed.counts.slice(1)) {
    assert.equal('updatedAt' in globalQuery, false, 'active/archived/trash-Zähler bleiben global');
  }
  assert.equal('updatedAt' in observed.aggregate, false, 'Tag-Cloud bleibt global');

  await assert.rejects(
    service.getAllNotes({ userId: 'user-id', since: 'gestern' }),
    (error) => error.statusCode === 400 && /ISO-8601/.test(error.message),
    'ungültige since-Werte sind 400, kein stilles Ignorieren'
  );
});

test('getNotesMeta: eine Aggregation, Bucket-Semantik wie getAllNotes', async () => {
  const maxUpdatedAt = new Date('2026-09-21T12:00:00.000Z');
  const observed = { pipeline: null };
  const userId = 'a'.repeat(24);
  const NoteMock = {
    aggregate: async (pipeline) => {
      observed.pipeline = pipeline;
      return [{ _id: null, active: 676, archived: 3, trash: 2, maxUpdatedAt }];
    }
  };
  const service = loadService(NoteMock);

  const meta = await service.getNotesMeta(userId);
  assert.deepEqual(meta, { active: 676, archived: 3, trash: 2, maxUpdatedAt });

  const match = observed.pipeline[0].$match;
  assert.equal(String(match.$or[0].userId), userId, 'eigene Notizen');
  assert.equal(String(match.$or[1].sharedWith), userId, 'und geteilte');
  const group = observed.pipeline[1].$group;
  const activeCond = group.active.$sum.$cond[0].$and;
  assert.equal(activeCond[0].$eq[0].$ifNull[0], '$deletedAt', 'fehlendes deletedAt zählt als aktiv');
  assert.equal(activeCond[1].$eq[0].$ifNull[0], '$isArchived', 'fehlendes isArchived zählt als aktiv');
  assert.ok(group.maxUpdatedAt, 'max(updatedAt) ist der Änderungs-Taktgeber');

  const empty = await loadService({ aggregate: async () => [] }).getNotesMeta(userId);
  assert.deepEqual(empty, { active: 0, archived: 0, trash: 0, maxUpdatedAt: null });
});

test('die meta-Route ist vor /:id registriert und reicht since durch', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../routes/notes.js'), 'utf8');
  const metaAt = routes.indexOf("router.get('/meta'");
  const treeAt = routes.indexOf("router.get('/tree'");
  const singleAt = routes.indexOf("router.get('/:id'");
  assert.ok(metaAt > -1 && metaAt < singleAt, '/meta muss vor /:id registriert sein');
  assert.ok(treeAt < singleAt);
  assert.match(routes, /getNoteTree\(req\.user\._id, req\.query\.since\)/);
  // v1.14.0: includeMeta kam dazu (Folgeseiten sparen sich Counts + Tag-Cloud).
  assert.match(routes, /folderId,\s*\n\s*since,\s*\n\s*\/\/ v1\.14\.0[^\n]*\n\s*includeMeta: req\.query\.includeMeta\s*\n\s*\}\);/);
});

// ---------------------------------------------------------------------------
// v1.14.0 Nr. 3 + Nr. 8 — revisions[] reist nicht mehr in Liste/Detail, und
// includeMeta=false lässt die globalen Counts + Tag-Aggregation weg.
// ---------------------------------------------------------------------------

test('Liste und Detail projizieren revisions weg (v1.14.0)', async () => {
  const selects = [];
  const chain = {
    populate: () => chain,
    select(arg) { selects.push(arg); return chain; },
    sort: () => chain,
    skip: () => chain,
    limit: async () => []
  };
  const service = loadService({
    countDocuments: async () => 0,
    aggregate: async () => [],
    find: () => chain,
    findOne: () => chain
  });

  await service.getAllNotes({ userId: 'u1', page: 1, limit: 10, archived: 'false' });
  await service.getNoteById('507f191e810c19729de860ea', 'u1').catch(() => {});
  assert.ok(selects.includes('-revisions'), 'beide Pfade schneiden revisions aus der Projektion');
});

test('includeMeta=false spart Counts und Tag-Aggregation ein', async () => {
  const seen = { counts: 0, aggregates: 0 };
  const chain = {
    populate: () => chain,
    select: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: async () => []
  };
  const service = loadService({
    countDocuments: async () => 0,
    aggregate: async () => { seen.aggregates += 1; return []; },
    find: () => chain
  });
  Object.defineProperty(seen, 'counts', { value: 0, writable: true });
  const countingService = loadService({
    countDocuments: async () => { seen.counts += 1; return 0; },
    aggregate: async () => { seen.aggregates += 1; return []; },
    find: () => chain
  });

  const lean = await countingService.getAllNotes({ userId: 'u1', page: 2, limit: 50, archived: 'false', includeMeta: false });
  // Genau EIN countDocuments bleibt: das Pagination-Total der Seite.
  assert.equal(seen.counts, 1, 'nur das Listen-Total wird noch gezählt');
  assert.equal(seen.aggregates, 0, 'die Tag-Aggregation fällt weg');
  assert.equal('counts' in lean, false, 'Antwort ohne counts-Schlüssel');
  assert.equal('tags' in lean, false, 'Antwort ohne tags-Schlüssel');
  assert.ok(lean.pagination, 'Pagination bleibt (pages braucht das Total)');

  // Der Query-Param kommt als String 'false' — auch der muss sparen.
  seen.counts = 0;
  await countingService.getAllNotes({ userId: 'u1', page: 2, archived: 'false', includeMeta: 'false' });
  assert.equal(seen.counts, 1, "includeMeta='false' (String) spart genauso");

  // Default: alles wie vorher — Seite 1 füttert die Sidebar.
  seen.counts = 0;
  const full = await countingService.getAllNotes({ userId: 'u1', page: 1, archived: 'false' });
  assert.equal(seen.counts, 4, 'ohne includeMeta laufen die vier Counts (total+3 global)');
  assert.equal(seen.aggregates, 1, 'die Tag-Cloud läuft');
  assert.deepEqual(full.counts, { active: 0, archived: 0, trash: 0 });
});
