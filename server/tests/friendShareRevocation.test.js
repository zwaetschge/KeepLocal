const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Audit 2026-09-12 (Nr. 2 der Top-30): "Freund entfernen" pulled zwar die
// Freundschaft aus beiden Users, liess `sharedWith` aber stehen. Mitbearbeiter
// duerfen Inhalt, Titel, Tags, Farbe, Pin und Bilder aendern — ein Ex-Freund
// behielt also stillen Schreibzugriff auf fremde Notizen. Beim Loeschen eines
// Users raeumt adminService.js dieselben Referenzen laengst weg.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const routerPath = require.resolve('../routes/friends');
const authPath = require.resolve('../middleware/auth');
const demoPolicyPath = require.resolve('../middleware/demoPolicy');

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const FRIEND = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function installMocks({ friendExists = true, modifiedCount = 1 } = {}) {
  const noteCalls = [];
  const userCalls = [];

  const NoteMock = {
    updateMany: async (filter, update) => {
      noteCalls.push({ filter, update });
      return { acknowledged: true, modifiedCount };
    }
  };
  const UserMock = {
    findById: async (id) => (friendExists && String(id) === FRIEND ? { _id: FRIEND, username: 'bob' } : null),
    updateOne: async (filter, update) => {
      userCalls.push({ filter, update });
      return { acknowledged: true, modifiedCount: 1 };
    }
  };

  for (const modulePath of [routerPath, servicePath]) {
    delete require.cache[modulePath];
  }
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => { req.user = { _id: ME, isAdmin: false }; next(); },
      requireAdmin: (req, _res, next) => next(),
      optionalAuth: (req, _res, next) => next()
    }
  };
  require.cache[demoPolicyPath] = {
    id: demoPolicyPath,
    filename: demoPolicyPath,
    loaded: true,
    exports: { blockDemoUser: () => (_req, _res, next) => next() }
  };

  return { noteCalls, userCalls };
}

test('removing a friend revokes the shares in both directions', async () => {
  const { noteCalls, userCalls } = installMocks();
  const { revokeSharedNotesBetween } = require(servicePath);

  const result = await revokeSharedNotesBetween(ME, FRIEND);

  assert.equal(result.revoked, 2, 'both directions report their modified notes');
  assert.equal(noteCalls.length, 2);

  const mine = noteCalls.find((call) => String(call.filter.userId) === ME);
  const theirs = noteCalls.find((call) => String(call.filter.userId) === FRIEND);
  assert.ok(mine && theirs, 'notes of both users must be cleaned');
  assert.deepEqual(mine.filter.sharedWith, FRIEND);
  assert.deepEqual(mine.update.$pull.sharedWith, FRIEND);
  assert.deepEqual(theirs.filter.sharedWith, ME);
  assert.deepEqual(theirs.update.$pull.sharedWith, ME);
  assert.equal(userCalls.length, 0, 'the service must not touch the friendship itself');
});

test('DELETE /api/friends/:friendId removes the friendship AND the shares', async () => {
  const { noteCalls, userCalls } = installMocks();
  const router = require(routerPath);

  const app = express();
  app.use(express.json());
  app.use('/api/friends', router);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/friends/${FRIEND}`, {
      method: 'DELETE'
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.revokedShares, 2, 'the response reports how many shares were revoked');

    // Freundschaft in beide Richtungen gelöst …
    assert.equal(userCalls.length, 2);
    assert.ok(userCalls.every((call) => call.update.$pull.friends));
    // … und die geteilten Notizen in beide Richtungen enträumt.
    assert.equal(noteCalls.length, 2, 'shares must be revoked on delete');
    assert.deepEqual(
      noteCalls.map((call) => String(call.filter.userId)).sort(),
      [ME, FRIEND].sort()
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('DELETE /api/friends/:friendId still answers 404 for an unknown user', async () => {
  const { noteCalls } = installMocks({ friendExists: false });
  const router = require(routerPath);

  const app = express();
  app.use('/api/friends', router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/friends/${FRIEND}`, {
      method: 'DELETE'
    });
    assert.equal(response.status, 404);
    assert.equal(noteCalls.length, 0, 'nothing may be revoked for a user that does not exist');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
