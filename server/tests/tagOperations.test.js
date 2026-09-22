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
      // v1.15.0 Case-Insensitivitaet nachbilden: Der Service filtert per
      // $toLower gegen die lowercased Quellen und matcht die Dokumente per
      // ^…$/$i-Regex. Der Mock vergleicht likewise kleingeschrieben — sonst
      // wuerden die Tests Grossbestaende gar nicht pruefen koennen.
      const condIn = update[0].$set.tags.$setUnion
        ? update[0].$set.tags.$setUnion[0].$filter.cond.$not[0].$in
        : update[0].$set.tags.$filter.cond.$not[0].$in;
      assert.deepEqual(condIn[0], { $toLower: '$$this' },
        'der Filter vergleicht den kleingeschriebenen Bestands-Tag');
      const sources = condIn[1];
      const target = update[0].$set.tags.$setUnion ? update[0].$set.tags.$setUnion[1][0] : null;
      const lower = (tag) => String(tag).toLowerCase();
      const matches = visibleTo(query.$or[0].userId).filter((doc) =>
        Array.isArray(doc.tags) && doc.tags.some((tag) => sources.includes(lower(tag))));
      for (const doc of matches) {
        doc.tags = target === null
          ? doc.tags.filter((tag) => !sources.includes(lower(tag)))
          : [...new Set([...doc.tags.filter((tag) => !sources.includes(lower(tag))), target])];
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

// ---------------------------------------------------------------------------
// Groß-/Kleinschreibung (v1.15.0): Der Bestand kann gemischte Schreibweisen
// tragen ("Projekt" neben "projekt" — der Trilium-Import lowercased seit jeher,
// der Web-/Android-Editor nicht). Tag-Cloud, Tag-Filter und die drei
// Tag-Operationen behandeln Schreibweisen seit v1.15.0 als denselben Tag.
// ---------------------------------------------------------------------------

test('rename erfasst gemischte Schreibweisen des Quell-Tags', async () => {
  const store = makeStore([
    note('a'.repeat(24), ['Projekt', 'arbeit']),
    note('b'.repeat(24), ['projekt']),
    note('c'.repeat(24), ['PROJEKT', 'liste']),
    note('d'.repeat(24), ['projekte']) // lange Variante: darf NICHT treffen
  ]);
  const service = loadService(store.NoteMock);

  const result = await service.applyTagOperation({ userId: OWNER_ID, action: 'rename', from: ['Projekt'], to: 'kunde' });

  assert.equal(result.modified, 3, 'alle drei Schreibweisen, aber nicht der längere Tag');
  assert.deepEqual(store.docs.get('a'.repeat(24)).tags, ['arbeit', 'kunde']);
  assert.deepEqual(store.docs.get('b'.repeat(24)).tags, ['kunde']);
  assert.deepEqual(store.docs.get('c'.repeat(24)).tags, ['liste', 'kunde']);
  assert.deepEqual(store.docs.get('d'.repeat(24)).tags, ['projekte'], 'Präfix-Tag bleibt unberührt');

  // Die Query matcht über case-insensitive Regex-Varianten der Quellen …
  const matchers = store.updateCalls[0].query.tags.$in;
  assert.equal(matchers.length, 1);
  assert.equal(matchers[0] instanceof RegExp, true);
  assert.equal(/i$/.test(matchers[0].flags), true, 'case-insensitiver Matcher');
  assert.equal(matchers[0].source, '^projekt$', 'anchored auf den lowercased Quell-Tag');
  // … und das Ziel wird kleingeschrieben geschrieben: kein neuer Mischbestand.
  assert.deepEqual(store.updateCalls[0].update[0].$set.tags.$setUnion[1], ['kunde']);
});

test('delete entfernt alle Schreibweisen, merge kollabiert sie auf ein kleingeschriebenes Ziel', async () => {
  const del = makeStore([
    note('a'.repeat(24), ['Projekt', 'arbeit']),
    note('b'.repeat(24), ['PROJEKT'])
  ]);
  const delService = loadService(del.NoteMock);
  const delResult = await delService.applyTagOperation({ userId: OWNER_ID, action: 'delete', from: ['projekt'] });
  assert.equal(delResult.modified, 2);
  assert.deepEqual(del.docs.get('a'.repeat(24)).tags, ['arbeit']);
  assert.deepEqual(del.docs.get('b'.repeat(24)).tags, []);

  // from mit gemischten Schreibweisen deduped auf einen Matcher; ein groß-
  // geschriebenes Ziel landet kleingeschrieben im Bestand.
  const merge = makeStore([
    note('s'.repeat(24), ['Projekt', 'projekt', 'shopping'])
  ]);
  const mergeService = loadService(merge.NoteMock);
  const mergeResult = await mergeService.applyTagOperation({
    userId: OWNER_ID, action: 'merge', from: ['Projekt', 'projekt'], to: 'Besorgungen'
  });
  assert.equal(mergeResult.modified, 1);
  assert.deepEqual(merge.docs.get('s'.repeat(24)).tags, ['shopping', 'besorgungen'],
    'beide Schreibweisen kollabieren zu genau einem kleingeschriebenen Ziel');
});

test('Tag-Operationen lehnen Regex-Metazeichen ab — die Query-Regex ist deshalb sicher', async () => {
  // Der Service bettet Quell-Tags in new RegExp(`^${tag}$`, 'i') ein. Das ist
  // nur sicher, weil TAG_PATTERN Metazeichen ablehnt — hier verhaltensgepinnt:
  for (const dangerous of ['c++', 'pro.jekt', 'a|b', 'tag\\d']) {
    await assert.rejects(
      () => loadService(makeStore([]).NoteMock)
        .applyTagOperation({ userId: OWNER_ID, action: 'delete', from: [dangerous] }),
      /Ungültiger Tag/
    );
  }
});

test('die Tag-Cloud gruppiert case-insensitiv und reicht vor $unwind nur tags weiter', async () => {
  // getAllNotes-Aggregation: $project {tags:1} VOR $unwind (v1.15.0 — $unwind
  // lief sonst ganze Dokumente inklusive Volltext durch), $group per $toLower,
  // damit "Projekt"/"projekt" EIN Chip mit ehrlicher Zahl ist.
  const initial = [
    { tags: ['Projekt', 'arbeit'] },
    { tags: ['projekt'] },
    { tags: ['PROJEKT'] },
    { tags: [] }
  ];
  let observedPipeline = null;
  const NoteMock = {
    countDocuments: async () => initial.length,
    aggregate: async (pipeline) => {
      observedPipeline = pipeline;
      assert.deepEqual(pipeline[1], { $project: { tags: 1 } },
        '$project schneidet auf tags ab, BEVOR $unwind die Dokumente vervielfacht');
      assert.deepEqual(pipeline[2], { $unwind: '$tags' });
      assert.deepEqual(pipeline[3], { $group: { _id: { $toLower: '$tags' }, count: { $sum: 1 } } },
        'gruppiert wird kleingeschrieben');
      const tally = new Map();
      for (const doc of initial) {
        for (const tag of doc.tags) {
          const key = String(tag).toLowerCase();
          tally.set(key, (tally.get(key) || 0) + 1);
        }
      }
      return [...tally.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, count]) => ({ name, count }));
    },
    find: () => ({
      select() { return this; },
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return Promise.resolve([]); }
    })
  };
  const service = loadService(NoteMock);

  const result = await service.getAllNotes({ userId: OWNER_ID });

  assert.deepEqual(result.tags, [
    { name: 'arbeit', count: 1 },
    { name: 'projekt', count: 3 }
  ], 'drei Schreibweisen → ein Chip mit count 3');
  assert.equal(observedPipeline[0].$match != null, true, 'die Sichtbarkeit ($match) bleibt vorne');
});

test('der ?tag=-Filter einer Listenabfrage ist case-insensitiv und exakt', async () => {
  let observedQuery = null;
  const NoteMock = {
    countDocuments: async (query) => {
      if (query && query.tags) observedQuery = query;
      return 0;
    },
    aggregate: async () => [],
    find: () => ({
      select() { return this; },
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit() { return Promise.resolve([]); }
    })
  };
  const service = loadService(NoteMock);

  await service.getAllNotes({ userId: OWNER_ID, tag: 'Projekt' });

  const regex = observedQuery.tags.$regex;
  assert.equal(regex instanceof RegExp, true);
  assert.equal(/i$/.test(regex.flags), true, 'Filter matcht unabhängig von der Schreibweise');
  assert.equal(regex.test('projekt'), true);
  assert.equal(regex.test('PROJEKT'), true);
  assert.equal(regex.test('projekte'), false, 'anchored: kein Präfix-Match');
});
