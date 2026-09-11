const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// Improvement #5 (VERBESSERUNGEN_2026-09-11): drag & drop inside a section used
// to be a no-op — the client reordered locally and immediately re-sorted by
// updatedAt, and nothing was persisted.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/notes');

const OWNER_ID = '507f191e810c19729de860ea';
const OTHER_ID = '507f191e810c19729de860eb';
const IDS = [
  '507f1f77bcf86cd799439011',
  '507f1f77bcf86cd799439012',
  '507f1f77bcf86cd799439013'
];

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

function leanChain(docs) {
  const chain = {
    select: () => chain,
    sort: () => chain,
    lean: async () => docs,
    then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject)
  };
  return chain;
}

test('a first reorder assigns a fresh descending block', async () => {
  const notes = IDS.map((id, index) => ({ _id: id, order: 0, isPinned: false, isArchived: false, index }));
  const written = [];
  const service = loadService({
    find: () => leanChain(notes),
    findOne: () => leanChain(null),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  const result = await service.reorderNotes(OWNER_ID, [IDS[2], IDS[0], IDS[1]]);

  assert.equal(result.updated, 3);
  assert.deepEqual(
    written.map(op => [String(op.updateOne.filter._id), op.updateOne.update.$set.order]),
    [[IDS[2], 3], [IDS[0], 2], [IDS[1], 1]],
    'the new sequence gets the highest value first'
  );
  for (const op of written) {
    assert.deepEqual(op.updateOne.filter, { _id: op.updateOne.filter._id, userId: OWNER_ID, deletedAt: null });
  }
});

test('a later reorder reuses the existing order values', async () => {
  const existing = new Map([
    [IDS[0], 9],
    [IDS[1], 5],
    [IDS[2], 1]
  ]);
  const notes = IDS.map(id => ({ _id: id, order: existing.get(id), isPinned: false, isArchived: false }));
  const written = [];
  const service = loadService({
    find: () => leanChain(notes),
    findOne: () => leanChain(null),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  await service.reorderNotes(OWNER_ID, [IDS[2], IDS[1], IDS[0]]);

  assert.deepEqual(
    written.map(op => [String(op.updateOne.filter._id), op.updateOne.update.$set.order]),
    [[IDS[2], 9], [IDS[1], 5], [IDS[0], 1]],
    'values are re-dealt, so notes outside the payload keep their position'
  );
});

test('a reorder above an already ordered section starts above its maximum', async () => {
  const notes = [IDS[0], IDS[1]].map(id => ({ _id: id, order: 0, isPinned: false, isArchived: false }));
  const written = [];
  const service = loadService({
    find: () => leanChain(notes),
    // Highest existing order in the section is 7.
    findOne: () => leanChain({ order: 7 }),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  await service.reorderNotes(OWNER_ID, [IDS[0], IDS[1]]);

  assert.deepEqual(
    written.map(op => op.updateOne.update.$set.order),
    [9, 8],
    'two notes on top of a section whose maximum is 7'
  );
});

test('foreign and unknown notes are ignored instead of reordered', async () => {
  const written = [];
  const service = loadService({
    // Only the first id belongs to the user.
    find: () => leanChain([{ _id: IDS[0], order: 4, isPinned: false, isArchived: false }]),
    findOne: () => leanChain(null),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  const result = await service.reorderNotes(OWNER_ID, [IDS[1], IDS[0]]);
  assert.equal(result.updated, 1);
  assert.deepEqual(written.map(op => String(op.updateOne.filter._id)), [IDS[0]]);
});

test('a reorder without any own note is a 404', async () => {
  const service = loadService({
    find: () => leanChain([]),
    findOne: () => leanChain(null),
    bulkWrite: async () => { throw new Error('must not write'); }
  });

  await assert.rejects(service.reorderNotes(OWNER_ID, [IDS[0]]), (error) => {
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('invalid reorder payloads are rejected as client errors', async () => {
  const service = loadService({ find: () => leanChain([]), bulkWrite: async () => ({}) });

  await assert.rejects(service.reorderNotes(OWNER_ID, []), /nicht-leeres Array/);
  await assert.rejects(service.reorderNotes(OWNER_ID, 'nope'), /nicht-leeres Array/);
  await assert.rejects(service.reorderNotes(OWNER_ID, ['not-an-id']), /Keine gültigen Notiz-IDs/);
  await assert.rejects(
    service.reorderNotes(OWNER_ID, Array.from({ length: 201 }, (_unused, i) => IDS[i % 3])),
    /Maximal 200/
  );
});

test('new notes stay at order 0 until a section is sorted manually', async () => {
  const saved = [];
  class NoteMock {
    constructor(data) { Object.assign(this, data); }
    async save() { saved.push(this); return this; }
  }
  NoteMock.findOne = () => leanChain(null);

  const service = loadService(NoteMock);
  await service.createNote({ content: 'erste Notiz' }, OWNER_ID);
  assert.equal(saved[0].order, 0);

  // Section already ordered -> the new note goes on top.
  NoteMock.findOne = () => leanChain({ order: 12 });
  await service.createNote({ content: 'zweite Notiz' }, OWNER_ID);
  assert.equal(saved[1].order, 13);
});

test('the list is sorted by manual order before recency', async () => {
  const seen = {};
  const chain = {
    populate() { return this; },
    sort(value) { seen.sort = value; return this; },
    skip() { return this; },
    limit() { return Promise.resolve([]); }
  };
  const service = loadService({
    countDocuments: async () => 0,
    aggregate: async () => [],
    find: () => chain
  });

  await service.getAllNotes({ userId: OWNER_ID, page: 1, limit: 50, archived: 'false' });
  assert.deepEqual(seen.sort, { isPinned: -1, order: -1, updatedAt: -1, createdAt: -1 });
});

test('the note model declares an order field and a matching index', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');

  assert.match(source, /order: \{\s*type: Number,\s*default: 0/);
  assert.match(source, /noteSchema\.index\(\{ userId: 1, isPinned: -1, isArchived: 1, order: -1, updatedAt: -1 \}\)/);
});

// ---------------------------------------------------------------------------
// HTTP level
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

test('PATCH /api/notes/reorder persists the order and validates the payload', async () => {
  const calls = [];
  const router = loadRouter({
    reorderNotes: async (userId, orderedIds) => { calls.push([userId, orderedIds]); return { updated: orderedIds.length }; }
  });

  await withServer(router, async base => {
    const ok = await fetch(`${base}/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: IDS })
    });
    const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(body.updated, 3);
    assert.deepEqual(calls[0], [OWNER_ID, IDS]);

    const notAnArray = await fetch(`${base}/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: 'nope' })
    });
    assert.equal(notAnArray.status, 400);

    const badId = await fetch(`${base}/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: ['not-an-id'] })
    });
    assert.equal(badId.status, 400);
  });
});
