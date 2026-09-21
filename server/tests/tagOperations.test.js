const test = require('node:test');
const assert = require('node:assert/strict');

// Tag-Verwaltung (v1.11.0): PATCH /api/notes/tags — rename/merge/delete als
// je ein updateMany. Service-Level-Tests mit dem Mock-Muster aus
// noteTree.test.js; der Mock interpretiert die Aggregation-Pipelines
// ($filter/$setUnion) handgestrickt nach.

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

function makeStore(initial = []) {
  const docs = new Map(initial.map((note) => [String(note._id), { ...note }]));
  const updateCalls = [];

  const visibleTo = (userId) => [...docs.values()].filter((doc) =>
    doc.deletedAt == null
    && (String(doc.userId) === String(userId)
      || (Array.isArray(doc.sharedWith) && doc.sharedWith.some((id) => String(id) === String(userId)))));

  const NoteMock = {
    updateMany: async (query, update) => {
      updateCalls.push({ query, update });
      const sources = update[0].$set.tags.$setUnion
        ? update[0].$set.tags.$setUnion[0].$filter.cond.$not[0].$in[1]
        : update[0].$set.tags.$filter.cond.$not[0].$in[1];
      const target = update[0].$set.tags.$setUnion ? update[0].$set.tags.$setUnion[1][0] : null;
      const matches = visibleTo(query.$or[0].userId).filter((doc) =>
        Array.isArray(doc.tags) && doc.tags.some((tag) => sources.includes(tag)));
      for (const doc of matches) {
        doc.tags = target === null
          ? doc.tags.filter((tag) => !sources.includes(tag))
          : [...new Set([...doc.tags.filter((tag) => !sources.includes(tag)), target])];
      }
      return { modifiedCount: matches.length };
    }
  };
  return { docs, updateCalls, NoteMock };
}

const note = (id, tags, extra = {}) => ({
  _id: id, userId: OWNER_ID, deletedAt: null, tags, sharedWith: [], ...extra
});

test('applyTagOperation rename schreibt alle Treffer in einem updateMany', async () => {
  const store = makeStore([
    note('a'.repeat(24), ['einkauf', 'liste']),
    note('b'.repeat(24), ['einkauf']),
    note('c'.repeat(24), ['arbeit'])
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: ['Einkauf'], to: 'Besorgungen' });

  assert.equal(result.modified, 2);
  assert.equal(store.updateCalls.length, 1, 'genau ein updateMany');
  assert.deepEqual(store.docs.get('a'.repeat(24)).tags, ['liste', 'besorgungen'], 'Quelle raus, Ziel rein, Rest bleibt');
  assert.deepEqual(store.docs.get('b'.repeat(24)).tags, ['besorgungen']);
  assert.deepEqual(store.docs.get('c'.repeat(24)).tags, ['arbeit'], 'unbeteiligte Notiz unberührt');

  const { query, update } = store.updateCalls[0];
  assert.deepEqual(query.$or, [{ userId: OWNER_ID }, { sharedWith: OWNER_ID }]);
  assert.equal(query.deletedAt, null);
  assert.equal(update[0].$set.updatedAt instanceof Date, true);
  assert.equal(String(update[0].$set.lastEditedBy), OWNER_ID);
});

test('applyTagOperation merge fasst zwei Quellen zu einem Ziel zusammen', async () => {
  const store = makeStore([
    note('a'.repeat(24), ['einkauf', 'shopping']),
    note('b'.repeat(24), ['shopping', 'liste']),
    note('c'.repeat(24), ['einkauf', 'besorgungen'])
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.applyTagOperation({ userId: OWNER_ID, action: 'merge', from: ['einkauf', 'shopping'], to: 'besorgungen' });

  assert.equal(result.modified, 3);
  assert.deepEqual(store.docs.get('a'.repeat(24)).tags, ['besorgungen'], 'beide Quellen kollabieren zu einem Ziel');
  assert.deepEqual(store.docs.get('b'.repeat(24)).tags, ['liste', 'besorgungen']);
  assert.deepEqual(store.docs.get('c'.repeat(24)).tags, ['besorgungen'], 'Ziel existierte schon — kein Duplikat');
});

test('applyTagOperation delete entfernt den Tag überall, Rest-Tags bleiben', async () => {
  const store = makeStore([
    note('a'.repeat(24), ['einkauf', 'liste']),
    note('b'.repeat(24), ['einkauf']),
    note('c'.repeat(24), ['arbeit'])
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.applyTagOperation({ userId: OWNER_ID, action: 'delete', from: ['einkauf'] });

  assert.equal(result.modified, 2);
  assert.deepEqual(store.docs.get('a'.repeat(24)).tags, ['liste']);
  assert.deepEqual(store.docs.get('b'.repeat(24)).tags, []);
});

test('applyTagOperation Scope: Papierkorb/fremde raus, geteilte Notizen rein', async () => {
  const store = makeStore([
    note('a'.repeat(24), ['einkauf']),
    note('t'.repeat(24), ['einkauf'], { deletedAt: new Date() }),
    { ...note('f'.repeat(24), ['einkauf']), userId: OTHER_ID },
    note('s'.repeat(24), ['einkauf'], { sharedWith: [OWNER_ID], userId: OTHER_ID })
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: ['einkauf'], to: 'besorgungen' });

  assert.equal(result.modified, 2, 'eigene + geteilte, nicht Papierkorb/fremde');
  assert.deepEqual(store.docs.get('s'.repeat(24)).tags, ['besorgungen'], 'geteilte Notiz mitgeändert');
  assert.deepEqual(store.docs.get('t'.repeat(24)).tags, ['einkauf']);
});

test('applyTagOperation validiert Aktion, Muster und No-Op-Rename', async () => {
  const store = makeStore([note('a'.repeat(24), ['einkauf'])]);
  const service = loadService(store.NoteMock);

  await assert.rejects(() => service.applyTagOperation({ userId: OWNER_ID, action: 'explode', from: ['x'], to: 'y' }), /action/);
  await assert.rejects(() => service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: [], to: 'y' }), /from/);
  await assert.rejects(() => service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: ['mit leerzeichen'], to: 'y' }), /Ungültiger Tag/);
  await assert.rejects(() => service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: ['x'], to: 'auch hier leer' }), /Ziel-Tag/);

  const noOp = await service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: ['einkauf'], to: 'einkauf' });
  assert.deepEqual(noOp, { action: 'rename', modified: 0 });
  assert.equal(store.updateCalls.length, 0, 'No-Op schreibt nichts');
  assert.deepEqual(store.docs.get('a'.repeat(24)).tags, ['einkauf']);
});
