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
