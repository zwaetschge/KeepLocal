const test = require('node:test');
const assert = require('node:assert/strict');

// Regression guards for BUG_REPORT_2026-09-10 (Runde 3):
//  #2 collaboration: shared notes must be editable/pinnable by collaborators,
//     while delete/archive/share/uploads stay owner-only (the UI hides them);
//  #3 sharing requires an accepted friendship;
//  #6 the list order must use the same recency key as the client.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

const NOTE_ID = '507f1f77bcf86cd799439011';
const OWNER_ID = '507f191e810c19729de860ea';
const FRIEND_ID = '507f191e810c19729de860eb';
const STRANGER_ID = '507f191e810c19729de860ec';

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

function storedNote(overrides = {}) {
  return {
    _id: NOTE_ID,
    title: 'Geteilte Notiz',
    content: 'Inhalt',
    color: '#ffffff',
    isPinned: false,
    isArchived: false,
    tags: [],
    isTodoList: false,
    todoItems: [],
    linkPreviews: [],
    userId: OWNER_ID,
    sharedWith: [FRIEND_ID],
    updatedAt: new Date('2026-09-10T10:00:00.000Z'),
    save: async function () { return this; },
    ...overrides
  };
}

test('a collaborator can update a shared note', async () => {
  const queries = [];
  const service = loadService({
    findOne: async (query) => { queries.push(query); return storedNote(); }
  });

  await service.updateNote(NOTE_ID, { content: 'Von Bob geaendert' }, FRIEND_ID);

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]._id, NOTE_ID);
  assert.ok(Array.isArray(queries[0].$or), 'the access filter must allow owner OR sharedWith');
  assert.deepEqual(queries[0].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
});

test('a collaborator can toggle the pin of a shared note', async () => {
  const queries = [];
  const service = loadService({
    findOne: async (query) => { queries.push(query); return storedNote(); }
  });

  await service.togglePinNote(NOTE_ID, FRIEND_ID);

  assert.deepEqual(queries[0].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
});

test('delete and archive stay owner-only', async () => {
  const deleteQueries = [];
  const archiveQueries = [];
  const service = loadService({
    findOne: async (query) => { archiveQueries.push(query); return storedNote(); },
    findOneAndDelete: async (query) => { deleteQueries.push(query); return storedNote({ images: [] }); }
  });

  await service.deleteNote(NOTE_ID, OWNER_ID);
  await service.toggleArchiveNote(NOTE_ID, OWNER_ID);

  assert.deepEqual(deleteQueries[0], { _id: NOTE_ID, userId: OWNER_ID });
  assert.deepEqual(archiveQueries[0], { _id: NOTE_ID, userId: OWNER_ID });
  assert.equal(deleteQueries[0].$or, undefined);
  assert.equal(archiveQueries[0].$or, undefined);
});

test('uploads and transcription keep the owner-only lookup', async () => {
  const queries = [];
  const service = loadService({
    findOne: async (query) => { queries.push(query); return storedNote(); }
  });

  await service.getOwnedNoteById(NOTE_ID, FRIEND_ID);

  assert.deepEqual(queries[0], { _id: NOTE_ID, userId: FRIEND_ID });
});

test('sharing a note requires an accepted friendship', async () => {
  // Mongoose's findById returns a thenable Query with .select(); the mock has
  // to behave the same way, otherwise `await findById(x).select('friends')`
  // fails on a plain promise.
  const query = (doc) => ({
    select: async () => doc,
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
  });
  const service = loadService(
    { findOneAndUpdate: async () => storedNote() },
    {
      findById: (id) => query(String(id) === STRANGER_ID
        ? { _id: STRANGER_ID, username: 'carol' }
        : { _id: OWNER_ID, username: 'alice', friends: [] })
    }
  );

  await assert.rejects(
    service.shareNote(NOTE_ID, OWNER_ID, STRANGER_ID),
    (error) => {
      assert.equal(error.statusCode, 403);
      assert.match(error.message, /Freunden geteilt/);
      return true;
    }
  );
});

test('sharing with a friend succeeds', async () => {
  const query = (doc) => ({
    select: async () => doc,
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
  });
  let updated = null;
  // findOneAndUpdate(...).populate(...).populate(...) — again a thenable chain.
  const updatedQuery = (doc) => ({
    populate: () => updatedQuery(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
  });
  const service = loadService(
    {
      findOneAndUpdate: (_query, update) => {
        updated = update;
        return updatedQuery(storedNote());
      }
    },
    {
      findById: (id) => query(String(id) === FRIEND_ID
        ? { _id: FRIEND_ID, username: 'bob' }
        : { _id: OWNER_ID, username: 'alice', friends: [FRIEND_ID] })
    }
  );

  await service.shareNote(NOTE_ID, OWNER_ID, FRIEND_ID);

  assert.deepEqual(updated, { $addToSet: { sharedWith: FRIEND_ID } });
});

test('the note list is ordered by the same recency key the client sorts by', async () => {
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

  assert.deepEqual(seen.sort, { isPinned: -1, updatedAt: -1, createdAt: -1 });
});
