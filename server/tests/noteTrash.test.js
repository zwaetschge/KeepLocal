const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Improvement #4 (VERBESSERUNGEN_2026-09-11): deleting a note used to remove the
// document and its image files immediately — a mis-click was unrecoverable.
// Notes now go to a trash with a 30-day TTL, can be restored, and are purged
// explicitly.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/notes');
const uploadsDir = path.resolve(__dirname, '../uploads/images');

const NOTE_ID = '507f1f77bcf86cd799439011';
const OWNER_ID = '507f191e810c19729de860ea';

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

test('regular list queries exclude trashed notes', async () => {
  const seen = { counts: [], aggregates: [] };
  const chain = {
    populate() { return this; },
    sort(value) { seen.sort = value; return this; },
    skip() { return this; },
    limit() { return Promise.resolve([]); }
  };
  const service = loadService({
    countDocuments: async (query) => { seen.counts.push(query); return 0; },
    aggregate: async (pipeline) => { seen.aggregates.push(pipeline[0].$match); return []; },
    find: () => chain
  });

  await service.getAllNotes({ userId: OWNER_ID, page: 1, limit: 50, archived: 'false' });

  assert.ok(seen.counts.length >= 4);
  const viewCounts = seen.counts.filter(query => query.deletedAt === null);
  const trashCounts = seen.counts.filter(query => query.deletedAt?.$ne === null);
  assert.equal(viewCounts.length, 3, 'total, active and archived counts must exclude the trash');
  assert.equal(trashCounts.length, 1, 'exactly one count targets the trash');
  for (const match of seen.aggregates) {
    assert.equal(match.deletedAt, null, 'tag aggregation misses the trash filter');
  }
  assert.equal(seen.sort.updatedAt, -1);
});

test('the trash view lists only own deleted notes, newest first', async () => {
  const seen = {};
  const chain = {
    populate() { return this; },
    sort(value) { seen.sort = value; return this; },
    skip() { return this; },
    limit() { return Promise.resolve([{ _id: NOTE_ID, deletedAt: new Date() }]); }
  };
  const service = loadService({
    countDocuments: async (query) => { seen.counts = seen.counts || []; seen.counts.push(query); return 2; },
    find: (query) => { seen.find = query; return chain; }
  });

  const result = await service.getAllNotes({ userId: OWNER_ID, page: 1, limit: 50, deleted: 'true' });

  assert.deepEqual(seen.find, { userId: OWNER_ID, deletedAt: { $ne: null } });
  assert.deepEqual(seen.sort, { deletedAt: -1 });
  assert.equal(result.pagination.total, 2);
  assert.equal(result.counts.trash, 2);
  assert.equal(result.notes.length, 1);
});

test('restore clears deletedAt and purge only accepts trashed notes', async () => {
  const seen = [];
  // restoreNote chains .populate().populate() on the update query.
  const populated = (doc) => ({
    populate: () => populated(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
  });
  const service = loadService({
    findOneAndUpdate: (query, update) => {
      seen.push({ op: 'update', query, update });
      return populated({ _id: NOTE_ID, deletedAt: null, images: [] });
    },
    findOneAndDelete: async (query) => {
      seen.push({ op: 'delete', query });
      return { _id: NOTE_ID, images: [] };
    },
    // Baum (v1.10.0): purge reparentet die Kinder des Knotens.
    updateMany: async () => ({ modifiedCount: 0 })
  });

  await service.restoreNote(NOTE_ID, OWNER_ID);
  assert.deepEqual(seen[0].query, { _id: NOTE_ID, userId: OWNER_ID, deletedAt: { $ne: null } });
  assert.deepEqual(seen[0].update, { $set: { deletedAt: null } });

  await service.purgeNote(NOTE_ID, OWNER_ID);
  assert.deepEqual(seen[1].query, { _id: NOTE_ID, userId: OWNER_ID, deletedAt: { $ne: null } },
    'purging must require an already trashed note');
});

test('purge removes the image files, soft delete does not', async () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const keep = `trash-keep-${process.pid}.png`;
  const gone = `trash-gone-${process.pid}.png`;
  fs.writeFileSync(path.join(uploadsDir, keep), 'x');
  fs.writeFileSync(path.join(uploadsDir, gone), 'x');

  const softService = loadService({
    findOneAndUpdate: async () => ({ _id: NOTE_ID, images: [{ filename: keep }], deletedAt: new Date() }),
    updateMany: async () => ({ modifiedCount: 0 })
  });
  await softService.deleteNote(NOTE_ID, OWNER_ID);
  assert.equal(fs.existsSync(path.join(uploadsDir, keep)), true, 'soft delete must keep files');

  const purgeService = loadService({
    findOneAndDelete: async () => ({ _id: NOTE_ID, images: [{ filename: gone }] }),
    updateMany: async () => ({ modifiedCount: 0 })
  });
  await purgeService.purgeNote(NOTE_ID, OWNER_ID);
  assert.equal(fs.existsSync(path.join(uploadsDir, gone)), false, 'purge removes files');

  fs.rmSync(path.join(uploadsDir, keep), { force: true });
});

test('emptying the trash removes documents and their files', async () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `trash-empty-${process.pid}.png`;
  fs.writeFileSync(path.join(uploadsDir, filename), 'x');

  const seen = [];
  const service = loadService({
    find: () => ({ select: async () => [{ _id: NOTE_ID, images: [{ filename }] }] }),
    deleteMany: async (query) => { seen.push(query); return { deletedCount: 1 }; },
    updateMany: async () => ({ modifiedCount: 0 })
  });

  const removed = await service.emptyTrash(OWNER_ID);

  assert.equal(removed, 1);
  // Mengentreu: geloescht wird genau die gelesene Menge (plus Prädikat), sonst
  // erwischen wir Notizen, die zwischen Find und Delete in den Papierkorb
  // wanderten — deren Dokumente wären weg, ihre Dateien für immer verwaist.
  assert.deepEqual(seen[0]._id.$in.map(String), [String(NOTE_ID)]);
  assert.equal(seen[0].userId, OWNER_ID);
  assert.deepEqual(seen[0].deletedAt, { $ne: null });
  assert.equal(fs.existsSync(path.join(uploadsDir, filename)), false);
});

test('empty trash is a no-op', async () => {
  const service = loadService({
    find: () => ({ select: async () => [] }),
    deleteMany: async () => { throw new Error('must not be called'); }
  });
  assert.equal(await service.emptyTrash(OWNER_ID), 0);
});

test('a trashed note cannot be edited, pinned or archived', async () => {
  const queries = [];
  const service = loadService({
    findOne: async (query) => { queries.push(query); return null; },
    findOneAndUpdate: async (query) => { queries.push(query); return null; }
  });

  await assert.rejects(service.updateNote(NOTE_ID, { content: 'x' }, OWNER_ID), /nicht gefunden/i);
  await assert.rejects(service.togglePinNote(NOTE_ID, OWNER_ID), /nicht gefunden/i);
  await assert.rejects(service.toggleArchiveNote(NOTE_ID, OWNER_ID), /nicht gefunden/i);

  for (const query of queries) {
    assert.equal(query.deletedAt, null, `trashed notes must be invisible: ${JSON.stringify(query)}`);
  }
});

test('the note model keeps a TTL backstop behind the janitor retention', () => {
  const source = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');
  assert.match(source, /deletedAt: \{/);
  assert.match(source, /name: 'trash_ttl'/);
  // Endgültig aufräumen tut services/storageJanitor.js bei 30 Tagen (erst die
  // Dateien, dann das Dokument); MongoDBs TTL-Monitor löscht nur Dokumente und
  // läuft deshalb einen Tag später als Backstop.
  assert.match(source, /expireAfterSeconds: 31 \* 24 \* 60 \* 60/);
  assert.match(source, /partialFilterExpression: \{ deletedAt: \{ \$type: 'date' \} \}/);

  const janitor = fs.readFileSync(path.join(__dirname, '../services/storageJanitor.js'), 'utf8');
  assert.match(janitor, /TRASH_RETENTION_DAYS', 30/);
});

// ---------------------------------------------------------------------------
// HTTP level: route order and contracts
// ---------------------------------------------------------------------------

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

test('DELETE /api/notes/trash empties the trash instead of parsing "trash" as an id', async () => {
  const calls = [];
  const router = loadRouter({
    emptyTrash: async (userId) => { calls.push(['emptyTrash', userId]); return 3; },
    purgeNote: async (id) => { calls.push(['purgeNote', id]); return {}; },
    deleteNote: async (id) => { calls.push(['deleteNote', id]); return {}; }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/trash`, { method: 'DELETE' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.removed, 3);
    assert.deepEqual(calls, [['emptyTrash', OWNER_ID]]);
  });
});

test('DELETE /api/notes/:id is a soft delete unless permanent=true', async () => {
  const calls = [];
  const router = loadRouter({
    deleteNote: async (id) => { calls.push(['deleteNote', id]); return { deletedAt: new Date() }; },
    purgeNote: async (id) => { calls.push(['purgeNote', id]); return { deletedAt: new Date() }; },
    emptyTrash: async () => { calls.push(['emptyTrash']); return 0; }
  });

  await withServer(router, async base => {
    const soft = await fetch(`${base}/${NOTE_ID}`, { method: 'DELETE' });
    const softBody = await soft.json();
    assert.equal(soft.status, 200);
    assert.match(softBody.message, /Papierkorb/);

    const hard = await fetch(`${base}/${NOTE_ID}?permanent=true`, { method: 'DELETE' });
    const hardBody = await hard.json();
    assert.equal(hard.status, 200);
    assert.match(hardBody.message, /endgültig/);

    assert.deepEqual(calls.map(call => call[0]), ['deleteNote', 'purgeNote']);
  });
});

test('DELETE /api/notes/:id rejects an invalid permanent flag', async () => {
  const router = loadRouter({ deleteNote: async () => ({}) });

  await withServer(router, async base => {
    const response = await fetch(`${base}/${NOTE_ID}?permanent=maybe`, { method: 'DELETE' });
    assert.equal(response.status, 400);
  });
});

test('POST /api/notes/:id/restore returns the restored note', async () => {
  const calls = [];
  const router = loadRouter({
    restoreNote: async (id, userId) => { calls.push([id, userId]); return { _id: id, deletedAt: null }; }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/${NOTE_ID}/restore`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body._id, NOTE_ID);
    assert.deepEqual(calls, [[NOTE_ID, OWNER_ID]]);
  });
});

test('GET /api/notes forwards the deleted filter and rejects invalid values', async () => {
  const seen = [];
  const router = loadRouter({
    getAllNotes: async (params) => {
      seen.push(params);
      return { notes: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 }, counts: { active: 0, archived: 0, trash: 0 }, tags: [] };
    }
  });

  await withServer(router, async base => {
    const ok = await fetch(`${base}/?deleted=true&page=1&limit=50`);
    assert.equal(ok.status, 200);
    assert.equal(seen[0].deleted, 'true');

    const bad = await fetch(`${base}/?deleted=1`);
    assert.equal(bad.status, 400);
  });
});
