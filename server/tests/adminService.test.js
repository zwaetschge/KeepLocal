const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mongoose = require('mongoose');
const userModelPath = require.resolve('../models/User');
const noteModelPath = require.resolve('../models/Note');
const apiKeyModelPath = require.resolve('../models/ApiKey');
const servicePath = require.resolve('../services/adminService');
const uploadsDir = path.resolve(__dirname, '../uploads/images');

function thenableUser(user) {
  return {
    session: async () => user,
    then(resolve, reject) {
      return Promise.resolve(user).then(resolve, reject);
    }
  };
}

test('admin deletion works on standalone MongoDB and cleans all references before files', async () => {
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => {
    throw new Error('transactions are unavailable on standalone MongoDB');
  };

  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `admin-delete-${process.pid}.png`;
  const filepath = path.join(uploadsDir, filename);
  fs.writeFileSync(filepath, 'test');

  const calls = [];
  const user = { _id: 'target-user', images: [], toObject: () => ({ _id: 'target-user' }) };
  const UserMock = {
    findById: () => thenableUser(user),
    updateMany: async (query, update) => calls.push(['users', query, update]),
    findByIdAndDelete: async id => calls.push(['delete-user', id])
  };
  const NoteMock = {
    find: async () => [{ images: [{ filename }] }],
    updateMany: async (query, update) => calls.push(['notes', query, update]),
    deleteMany: async query => calls.push(['delete-notes', query])
  };
  const ApiKeyMock = {
    deleteMany: async query => calls.push(['delete-keys', query])
  };

  delete require.cache[servicePath];
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[apiKeyModelPath] = { id: apiKeyModelPath, filename: apiKeyModelPath, loaded: true, exports: ApiKeyMock };
  const service = require(servicePath);

  try {
    const deleted = await service.deleteUser('target-user', 'current-user');
    assert.equal(deleted, user);
    assert.equal(calls.some(call => call[0] === 'delete-keys'), true);
    assert.equal(calls.some(call => call[0] === 'users' && JSON.stringify(call[1]).includes('friendRequests.from')), true);
    assert.equal(fs.existsSync(filepath), false);
  } finally {
    mongoose.startSession = originalStartSession;
    fs.rmSync(filepath, { force: true });
  }
});
