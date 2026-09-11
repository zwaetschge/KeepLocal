const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BUG_REPORT_2026-09-10 (Runde 3) #10: `username` is stored case-sensitively
// (only `email` is lowercased) while the friend search matches
// case-insensitively. Without a casing-aware duplicate check "ALICE" could be
// created next to "alice", and both accounts show up as interchangeable hits in
// search and friend lists.

const adminServicePath = require.resolve('../services/adminService');
const userModelPath = require.resolve('../models/User');

function loadService(existingUser) {
  const captured = {};

  class UserMock {
    constructor(data) {
      Object.assign(this, data);
      captured.created = data;
    }

    async save() {
      captured.saved = true;
      return this;
    }

    toObject() {
      return { ...this };
    }
  }
  UserMock.findOne = async (query) => {
    captured.query = query;
    return existingUser;
  };

  delete require.cache[adminServicePath];
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return { service: require(adminServicePath), captured };
}

test('admin user creation rejects a username that differs only in casing', async () => {
  const { service, captured } = loadService({ username: 'alice', email: 'alice@example.com' });

  await assert.rejects(
    service.createUser({ username: 'ALICE', email: 'other@example.com', password: 'Secret123x' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      return true;
    }
  );

  const casingRule = captured.query.$or.find(rule => rule.username?.$regex);
  assert.ok(casingRule, 'the duplicate check must include a case-insensitive username rule');
  assert.equal(casingRule.username.$regex.source, '^ALICE$');
  assert.equal(casingRule.username.$regex.flags, 'i');
});

test('admin user creation still works for a fresh username', async () => {
  const { service, captured } = loadService(null);

  await service.createUser({ username: 'dave', email: 'dave@example.com', password: 'Secret123x', isAdmin: false });

  assert.equal(captured.saved, true);
  assert.equal(captured.created.username, 'dave');
  const casingRule = captured.query.$or.find(rule => rule.username?.$regex);
  assert.equal(casingRule.username.$regex.test('DAVE'), true);
  assert.equal(casingRule.username.$regex.test('bob'), false);
});

test('registration applies the same casing-aware duplicate check', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
  const register = source.split("router.post('/register'")[1].split("router.post('/login'")[0];

  assert.match(register, /escapeRegex\(username\)/);
  assert.match(register, /\$regex: new RegExp\(`\^\$\{escapeRegex\(username\)\}\$`, 'i'\)/);
});

test('a username with regex metacharacters cannot widen the duplicate check', () => {
  const { escapeRegex } = require('../utils/sanitize');
  const pattern = new RegExp(`^${escapeRegex('a.b*c')}$`, 'i');

  assert.equal(pattern.test('a.b*c'), true);
  assert.equal(pattern.test('axbxc'), false, 'metacharacters must stay literal');
});

// The admin route implements its own duplicate check (it does not go through
// adminService.createUser), so it needs the same casing-aware rule.
const express = require('express');
const http = require('node:http');
const adminRouterPath = require.resolve('../routes/admin');
const authMiddlewarePath = require.resolve('../middleware/auth');

function loadAdminRouter(existingUser) {
  const captured = {};

  class UserMock {
    constructor(data) { Object.assign(this, data); }
    async save() { captured.saved = true; return this; }
  }
  UserMock.findOne = async (query) => { captured.query = query; return existingUser; };

  for (const p of [adminRouterPath, authMiddlewarePath, userModelPath]) delete require.cache[p];
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  require.cache[authMiddlewarePath] = {
    id: authMiddlewarePath, filename: authMiddlewarePath, loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => { req.user = { _id: 'admin-id', isAdmin: true }; next(); }
    }
  };
  return { router: require(adminRouterPath), captured };
}

async function postUser(router, payload) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [adminRouterPath, authMiddlewarePath, userModelPath]) delete require.cache[p];
  }
}

test('POST /api/admin/users rejects a username that differs only in casing', async () => {
  const { router, captured } = loadAdminRouter({ username: 'dave', email: 'dave@example.com' });

  const { status, body } = await postUser(router, {
    username: 'DAVE', email: 'other@example.com', password: 'Secret123x'
  });

  assert.equal(status, 400);
  assert.match(body.error, /Benutzername bereits vergeben/);
  assert.equal(captured.saved, undefined);
  const casingRule = captured.query.$or.find(rule => rule.username?.$regex);
  assert.ok(casingRule, 'the route must query case-insensitively');
  assert.equal(casingRule.username.$regex.flags, 'i');
});

test('POST /api/admin/users creates a user with an unused username', async () => {
  const { router, captured } = loadAdminRouter(null);

  const { status } = await postUser(router, {
    username: 'erin', email: 'erin@example.com', password: 'Secret123x'
  });

  assert.equal(status, 201);
  assert.equal(captured.saved, true);
});
