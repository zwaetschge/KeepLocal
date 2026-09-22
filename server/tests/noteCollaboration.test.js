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
    findOne: async (query) => { queries.push(query); return storedNote(); },
    findOneAndUpdate: async (query) => { queries.push(query); return storedNote(); }
  });

  await service.updateNote(NOTE_ID, { content: 'Von Bob geaendert' }, FRIEND_ID);

  // queries[0] = Lesen, queries[1] = bedingtes Schreiben — beide mit dem
  // kollaborativen Zugriffsfilter.
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0]._id, NOTE_ID);
  assert.ok(Array.isArray(queries[0].$or), 'the access filter must allow owner OR sharedWith');
  assert.deepEqual(queries[0].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
  assert.deepEqual(queries[1].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
});

test('a collaborator can toggle the pin of a shared note', async () => {
  const queries = [];
  const service = loadService({
    findOneAndUpdate: async (query) => { queries.push(query); return storedNote(); }
  });

  await service.togglePinNote(NOTE_ID, FRIEND_ID);

  assert.deepEqual(queries[0].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
});

test('delete and archive stay owner-only and respect the trash', async () => {
  const writes = [];
  const service = loadService({
    findOneAndUpdate: async (query, update) => { writes.push({ query, update }); return storedNote({ images: [] }); },
    // Baum (v1.10.0): deleteNote reparentet die Kinder des Knotens.
    updateMany: async () => ({ modifiedCount: 0 })
  });

  await service.deleteNote(NOTE_ID, OWNER_ID);
  await service.toggleArchiveNote(NOTE_ID, OWNER_ID);

  // Soft delete: owner-only, only notes that are not already trashed.
  assert.deepEqual(writes[0].query, { _id: NOTE_ID, userId: OWNER_ID, deletedAt: null });
  assert.ok(writes[0].update.$set.deletedAt instanceof Date);
  // Archive toggle: ebenfalls owner-only, atomar per Update-Pipeline.
  assert.deepEqual(writes[1].query, { _id: NOTE_ID, userId: OWNER_ID, deletedAt: null });
  assert.ok(Array.isArray(writes[1].update), 'the toggle must be an atomic pipeline update');
  assert.deepEqual(
    writes[1].update[0].$set.isArchived,
    { $not: ['$isArchived'] }
  );
  assert.equal(writes[0].query.$or, undefined);
  assert.equal(writes[1].query.$or, undefined);
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

test('the note list is ordered by manual order, then the recency key the client sorts by', async () => {
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

  assert.deepEqual(seen.sort, { isPinned: -1, order: -1, updatedAt: -1, createdAt: -1 });
});

// Improvement #8 (VERBESSERUNGEN_2026-09-11): collaborators may change the
// content — which includes images and transcriptions — while destructive and
// structural actions stay with the owner.
test('uploads and transcriptions are open to collaborators but not to strangers', async () => {
  const queries = [];
  const service = loadService({
    findOne: async (query) => {
      queries.push(query);
      const askedFor = query.$or?.some(part => part.sharedWith === FRIEND_ID);
      return askedFor ? storedNote() : null;
    }
  });

  const note = await service.getEditableNoteById(NOTE_ID, FRIEND_ID);
  assert.equal(note._id, NOTE_ID);
  assert.deepEqual(queries[0].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
  assert.equal(queries[0].deletedAt, null);

  await assert.rejects(service.getEditableNoteById(NOTE_ID, STRANGER_ID), (error) => {
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('an edit records who made it', async () => {
  const writes = [];
  const service = loadService({
    findOne: async () => storedNote(),
    findOneAndUpdate: async (query, update) => { writes.push(update); return storedNote(); }
  });

  await service.updateNote(NOTE_ID, { content: 'von bob' }, FRIEND_ID);

  assert.equal(String(writes[0].$set.lastEditedBy), FRIEND_ID);
  assert.equal(writes[0].$set.content, 'von bob');
});

test('image mutations use the collaborative query', async () => {
  const queries = [];
  const populated = (doc) => ({
    populate: () => populated(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
  });
  const service = loadService({
    findOneAndUpdate: (query) => {
      queries.push(query);
      return populated(storedNote({ images: [] }));
    }
  });

  await service.removeImage(NOTE_ID, FRIEND_ID, 'some-image.png');

  assert.deepEqual(queries[0].$or, [{ userId: FRIEND_ID }, { sharedWith: FRIEND_ID }]);
  assert.equal(queries[0]['images.filename'], 'some-image.png');
  assert.equal(queries[0].userId, undefined, 'the owner-only filter must be gone');
});

test('the list and single-note responses populate the last editor', async () => {
  const populatedFields = [];
  const chain = {
    populate(field) { populatedFields.push(field); return this; },
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return Promise.resolve([]); }
  };
  const service = loadService({
    countDocuments: async () => 0,
    aggregate: async () => [],
    find: () => chain,
    findOne: () => chain
  });

  await service.getAllNotes({ userId: OWNER_ID, page: 1, limit: 10, archived: 'false' });
  assert.ok(populatedFields.includes('lastEditedBy'), 'the list must populate lastEditedBy');

  populatedFields.length = 0;
  await service.getNoteById(NOTE_ID, OWNER_ID).catch(() => {});
  assert.ok(populatedFields.includes('lastEditedBy'), 'a single note must populate lastEditedBy');
});

// v1.13.0 Nr. 6 — Baum × Teilen: geteilte Notizen erschienen nie im Baum, und
// ein Mitbearbeiter konnte die fremde Notiz an EIGENE Knoten hängen (dann
// verschwand sie aus dem Baum des Besitzers). Struktur ist Besitzer-Sache.
test('a collaborator cannot move a shared note in the tree', async () => {
  const service = loadService({
    findOne: async () => storedNote({ parentId: '507f1f77bcf86cd7994390aa' }),
    findOneAndUpdate: async () => storedNote()
  });

  await assert.rejects(
    () => service.updateNote(NOTE_ID, { parentId: null }, FRIEND_ID),
    /Nur der Besitzer/
  );
  await assert.rejects(
    () => service.updateNote(NOTE_ID, { parentId: '507f1f77bcf86cd7994390bb' }, FRIEND_ID),
    /Nur der Besitzer/
  );
});

test('a collaborator sending unchanged parentId/order edits content but never structure', async () => {
  const parentId = '507f1f77bcf86cd7994390aa';
  let captured = null;
  const service = loadService({
    findOne: async () => storedNote({ parentId, order: 5 }),
    findOneAndUpdate: async (query, update) => { captured = update.$set; return storedNote({ parentId, order: 5 }); }
  });

  await service.updateNote(NOTE_ID, { content: 'vom Freund geaendert', parentId, order: 5 }, FRIEND_ID);

  assert.equal(captured.content, 'vom Freund geaendert');
  assert.equal(captured.parentId, undefined, 'structure must not be written for collaborators');
  assert.equal(captured.order, undefined);
  assert.equal(captured.lastEditedBy, FRIEND_ID);
});

test('the owner still validates parents against their own tree', async () => {
  // Der Besitzer verschiebt auf einen fremden Knoten (gehört dem Freund):
// assertValidParent läuft gegen den BESITZER, nicht mehr gegen den Editor.
  const parents = [];
  const service = loadService({
    // assertValidParent chained .lean() synchronously auf dem findOne-Ergebnis —
    // das Mock darf also kein async sein (async liefert eine Promise ohne .lean).
    findOne: (query) => {
      if (query.$or) return Promise.resolve(storedNote()); // noteEditQuery: die Notiz selbst
      parents.push(query); // assertValidParent: Eltern-Lookup gegen den Besitzer
      return { lean: () => Promise.resolve(null) }; // Parent gehört niemandem → 400
    },
    findOneAndUpdate: async () => storedNote()
  });

  await assert.rejects(
    () => service.updateNote(NOTE_ID, { parentId: '507f1f77bcf86cd7994390cc' }, OWNER_ID),
    /Uebergeordnete Notiz nicht gefunden/
  );
  assert.ok(parents.every((query) => String(query.userId) === OWNER_ID),
    'parent lookup must run against the note owner');
});
