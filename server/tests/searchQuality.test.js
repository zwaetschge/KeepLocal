const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Improvement #9 (VERBESSERUNGEN_2026-09-11): the text index had no weights (a
// title match ranked like a body match), used the English default language, and
// the sidebar tag counts ignored the active search.

const {
  ensureNoteTextIndex,
  isNoteTextIndex,
  isCurrentTextIndex,
  TARGET_INDEX_NAME,
  TARGET_WEIGHTS,
  TARGET_LANGUAGE
} = require('../config/indexMigration');

const LEGACY_INDEX = {
  name: 'title_text_content_text_todoItems.text_text',
  key: { _fts: 'text', _ftsx: 1 },
  // MongoDB fills these in for an index created without options — a legacy index
  // is NOT recognisable by missing weights.
  weights: { content: 1, title: 1, 'todoItems.text': 1 },
  default_language: 'english'
};
const CURRENT_INDEX = {
  name: TARGET_INDEX_NAME,
  key: { _fts: 'text', _ftsx: 1 },
  weights: TARGET_WEIGHTS,
  default_language: TARGET_LANGUAGE
};

function fakeConnection(indexes, { failRead = false } = {}) {
  const dropped = [];
  return {
    dropped,
    collection: () => ({
      indexes: async () => {
        if (failRead) throw new Error('ns not found');
        return indexes;
      },
      dropIndex: async (name) => { dropped.push(name); }
    })
  };
}

test('a legacy unweighted text index is detected and dropped', async () => {
  const connection = fakeConnection([{ name: '_id_', key: { _id: 1 } }, LEGACY_INDEX]);

  const result = await ensureNoteTextIndex(connection);

  assert.equal(result.dropped, LEGACY_INDEX.name);
  assert.deepEqual(connection.dropped, [LEGACY_INDEX.name]);
});

test('the migration is idempotent once the current index exists', async () => {
  const connection = fakeConnection([{ name: '_id_', key: { _id: 1 } }, CURRENT_INDEX]);

  const result = await ensureNoteTextIndex(connection);

  assert.equal(result.dropped, null);
  assert.equal(result.reason, 'text index is current');
  assert.deepEqual(connection.dropped, []);
});

test('a database without the collection or without a text index is left alone', async () => {
  const empty = fakeConnection([]);
  assert.deepEqual(await ensureNoteTextIndex(empty), { dropped: null, reason: 'no text index yet' });

  const unreadable = fakeConnection([], { failRead: true });
  const result = await ensureNoteTextIndex(unreadable);
  assert.equal(result.dropped, null);
  assert.match(result.reason, /no indexes readable/);

  const otherIndexes = fakeConnection([{ name: '_id_', key: { _id: 1 } }, { name: 'userId_1', key: { userId: 1 } }]);
  assert.deepEqual(await ensureNoteTextIndex(otherIndexes), { dropped: null, reason: 'no text index yet' });
});

test('only text indexes over the note search fields are considered', () => {
  assert.equal(isNoteTextIndex(LEGACY_INDEX), true);
  assert.equal(isNoteTextIndex(CURRENT_INDEX), true);
  assert.equal(isNoteTextIndex({ name: 'x', key: { _id: 1 } }), false);
  assert.equal(isNoteTextIndex({ name: 'x', key: { _fts: 'text', _ftsx: 1 }, weights: { title: 1 } }), false,
    'a text index over other fields must not be touched');
  assert.equal(isNoteTextIndex(null), false);

  assert.equal(isCurrentTextIndex(CURRENT_INDEX), true);
  assert.equal(isCurrentTextIndex(LEGACY_INDEX), false);
  assert.equal(isCurrentTextIndex({ ...CURRENT_INDEX, default_language: 'english' }), false);
  assert.equal(isCurrentTextIndex({ ...CURRENT_INDEX, weights: { ...TARGET_WEIGHTS, title: 1 } }), false);
});

test('model index definition and migration target agree', () => {
  const model = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');

  assert.match(model, /name: 'note_text_search'/);
  assert.match(model, /weights: \{ title: 5, 'todoItems\.text': 2, content: 1 \}/);
  assert.match(model, /default_language: 'none'/);

  assert.equal(TARGET_INDEX_NAME, 'note_text_search');
  assert.deepEqual(TARGET_WEIGHTS, { title: 5, content: 1, 'todoItems.text': 2 });
  assert.equal(TARGET_LANGUAGE, 'none');
});

test('the server runs the migration before building schema indexes', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const migrationIndex = server.indexOf('await ensureNoteTextIndex(mongoose.connection)');
  // Since the upgrade fix, startup calls syncIndexes() (drops conflicting or
  // stale indexes, recreates the schema ones) instead of the bare init().
  const initIndex = server.indexOf('model.syncIndexes()');

  assert.ok(migrationIndex > -1, 'the migration must be called at startup');
  assert.ok(initIndex > -1, 'the schema indexes must still be synchronised at startup');
  assert.ok(migrationIndex < initIndex, 'the migration must run BEFORE the indexes are built');
});

// ---------------------------------------------------------------------------
// Query shape
// ---------------------------------------------------------------------------

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

function loadService() {
  const seen = { aggregates: [], projections: [], sorts: [] };
  const chain = {
    populate() { return this; },
    sort(value) { seen.sorts.push(value); return this; },
    skip() { return this; },
    limit() { return Promise.resolve([]); }
  };
  delete require.cache[servicePath];
  require.cache[noteModelPath] = {
    id: noteModelPath, filename: noteModelPath, loaded: true,
    exports: {
      countDocuments: async () => 0,
      aggregate: async (pipeline) => { seen.aggregates.push(pipeline[0].$match); return []; },
      find: (query, projection) => { seen.projections.push(projection); return chain; }
    }
  };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: {} };
  return { service: require(servicePath), seen };
}

test('searching ranks by relevance, listing without search keeps the old order', async () => {
  const { service, seen } = loadService();

  await service.getAllNotes({ userId: 'u1', search: 'brot', page: 1, limit: 10, archived: 'false' });
  assert.deepEqual(seen.projections[0], { score: { $meta: 'textScore' } });
  assert.deepEqual(seen.sorts[0], { isPinned: -1, score: { $meta: 'textScore' } });

  await service.getAllNotes({ userId: 'u1', page: 1, limit: 10, archived: 'false' });
  assert.equal(seen.projections[1], undefined);
  assert.deepEqual(seen.sorts[1], { isPinned: -1, order: -1, updatedAt: -1, createdAt: -1 });
});

test('tag counts respect the active search', async () => {
  const { service, seen } = loadService();

  await service.getAllNotes({ userId: 'u1', page: 1, limit: 10, archived: 'false' });
  assert.equal(seen.aggregates[0].$text, undefined, 'without a search the tags count the whole view');

  await service.getAllNotes({ userId: 'u1', search: 'brot', page: 1, limit: 10, archived: 'false' });
  assert.deepEqual(seen.aggregates[1].$text, { $search: 'brot' });
  assert.equal(seen.aggregates[1].deletedAt, null, 'the trash stays out of the tag counts');
});
