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
  '507f1f77bcf86cd799439013',
  '507f1f77bcf86cd799439014',
  '507f1f77bcf86cd799439015'
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

test('a page-local reorder of unsorted notes stays below the sorted section (v1.18.0)', async () => {
  // Abschnitt: eine sortierte Notiz (order 7) oben, zwei unsortierte (order 0)
  // darunter. Der Payload ist die sichtbare Seite der beiden Unsortierten —
  // der Drag darf sie nicht über die sortierte Notiz heben.
  const section = [
    { _id: IDS[2], order: 7, isPinned: false, isArchived: false },
    { _id: IDS[0], order: 0, isPinned: false, isArchived: false },
    { _id: IDS[1], order: 0, isPinned: false, isArchived: false }
  ];
  const written = [];
  const service = loadService({
    find: () => leanChain(section),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  await service.reorderNotes(OWNER_ID, [IDS[0], IDS[1]]);

  assert.deepEqual(
    written.map(op => op.updateOne.update.$set.order),
    [2, 1],
    'Block dicht über 0 und unter der sortierten 7 — kein Sprung an die Spitze'
  );
});

test('a dense sorted section gets the new block below it, not above (v1.18.0)', async () => {
  // Der Normalfall nach dem ersten Sortieren einer Seite: dichte Orders 3..1,
  // Seite 2 komplett unsortiert (0). Zwischen 0 und 1 ist kein freier Slot —
  // der Block muss NEGATIV unter die sortierte Seite, nicht über sie (Review
  // v1.18.0: der alte sectionMax-Fallback sprang genau nach oben).
  const section = [
    { _id: IDS[2], order: 3, isPinned: false, isArchived: false },
    { _id: IDS[3], order: 2, isPinned: false, isArchived: false },
    { _id: IDS[4], order: 1, isPinned: false, isArchived: false },
    { _id: IDS[0], order: 0, isPinned: false, isArchived: false },
    { _id: IDS[1], order: 0, isPinned: false, isArchived: false }
  ];
  const written = [];
  const service = loadService({
    find: () => leanChain(section),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  await service.reorderNotes(OWNER_ID, [IDS[0], IDS[1]]);

  assert.deepEqual(
    written.map(op => op.updateOne.update.$set.order),
    [-1, -2],
    'dichter Abschnitt: Block unterhalb, negative Orders sind erlaubt'
  );
});

test('a reorder covering the section top starts above its maximum (v1.18.0)', async () => {
  // Der Payload HAT die höchsten Orders des Abschnitts (7, gebunden) — erst
  // dann darf ein frischer Block über dem Maximum vergeben werden.
  const section = [
    { _id: IDS[0], order: 7, isPinned: false, isArchived: false },
    { _id: IDS[1], order: 7, isPinned: false, isArchived: false },
    { _id: IDS[2], order: 3, isPinned: false, isArchived: false }
  ];
  const written = [];
  const service = loadService({
    find: () => leanChain(section),
    bulkWrite: async (ops) => { written.push(...ops); return { modifiedCount: ops.length }; }
  });

  await service.reorderNotes(OWNER_ID, [IDS[0], IDS[1]]);

  assert.deepEqual(
    written.map(op => op.updateOne.update.$set.order),
    [9, 8],
    'zwei Notizen an der Spitze eines Abschnitts mit Maximum 7'
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
    select() { return this; },
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
  assert.deepEqual(seen.sort, { isPinned: -1, order: -1, updatedAt: -1, createdAt: -1, _id: -1 });
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
    const firstThree = IDS.slice(0, 3);
    const ok = await fetch(`${base}/reorder`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: firstThree })
    });
    const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(body.updated, 3);
    assert.deepEqual(calls[0], [OWNER_ID, firstThree]);

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

// ---------------------------------------------------------------------------
// order per Einzel-Update (PUT): Vor dem Fix wurde ein mitgeschicktes `order`
// stillschweigend verworfen — Dritte konnten eine Position nur über den
// Sammel-Reorder setzen.
// ---------------------------------------------------------------------------

/**
 * Mock für den bedingten Schreibpfad von updateNote: findOne liest den Stand,
 * findOneAndUpdate schreibt mit updatedAt-Precondition (Muster wie in
 * optimisticLocking.test.js).
 */
function updatableModel({ writes = [] } = {}) {
  const stored = {
    title: 'Titel', content: 'Inhalt', color: '#ffffff', isPinned: false,
    tags: [], isTodoList: false, todoItems: [], linkPreviews: [],
    // v1.13.0: updateNote prüft Besitzer vs. Mitbearbeiter (Baum × Teilen) —
    // ohne userId wäre dieser Mock ein Collaborator und order/parentId fielen weg.
    userId: OWNER_ID,
    order: 4, updatedAt: new Date('2026-09-06T10:00:00.000Z')
  };
  return {
    writes,
    findOne: async () => stored,
    findOneAndUpdate: async (query, update, options) => {
      writes.push({ query, update, options });
      return { ...stored, ...update.$set };
    }
  };
}

test('update with order persists the position (order 0 resets manual sort)', async () => {
  const model = updatableModel();
  const service = loadService(model);

  await service.updateNote(IDS[0], { order: 12 }, OWNER_ID);
  assert.equal(model.writes[0].update.$set.order, 12, 'order lands in $set');

  model.writes.length = 0;
  await service.updateNote(IDS[0], { order: 0 }, OWNER_ID);
  assert.equal(model.writes[0].update.$set.order, 0, 'order 0 = zurück auf "nie manuell sortiert"');
});

test('update without order leaves the field untouched', async () => {
  const model = updatableModel();
  const service = loadService(model);

  await service.updateNote(IDS[0], { title: 'Neu' }, OWNER_ID);

  assert.equal('order' in model.writes[0].update.$set, false, 'no order key without a sent order');
});

test('invalid order values are rejected before any database read', async () => {
  for (const bad of [-1, 1.5, '3', 2147483648, null]) {
    const model = updatableModel();
    const service = loadService(model);
    await assert.rejects(
      service.updateNote(IDS[0], { order: bad }, OWNER_ID),
      (error) => error.statusCode === 400,
      `order=${JSON.stringify(bad)} muss als 400 abgewiesen werden`
    );
    assert.equal(model.writes.length, 0, `order=${JSON.stringify(bad)}: kein Schreibversuch`);
  }
});
