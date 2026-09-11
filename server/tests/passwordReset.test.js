process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';
process.env.CSRF_SECRET = process.env.CSRF_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

// Improvement #2 (VERBESSERUNGEN_2026-09-11): password change for the own
// account and an admin-generated one-time reset token. Self-hosted KeepLocal has
// no mail delivery, so the token is shown once in the admin console.

const userModelPath = require.resolve('../models/User');
const authMiddlewarePath = require.resolve('../middleware/auth');
const authRouterPath = require.resolve('../routes/auth');
const adminRouterPath = require.resolve('../routes/admin');
const adminServicePath = require.resolve('../services/adminService');
const { generateToken } = require('../middleware/auth');
const { createPasswordResetToken, hashPasswordResetToken, RESET_TOKEN_TTL_MS } = require('../utils/passwordReset');

const USER_ID = '507f191e810c19729de860ea';
const OTHER_ID = '507f191e810c19729de860eb';
const CURRENT_PASSWORD = 'Alt12345x';
const CURRENT_HASH = bcrypt.hashSync(CURRENT_PASSWORD, 4);

function queryLike(doc) {
  return {
    select: () => queryLike(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject)
  };
}

/**
 * @param {Object} options
 * @param {Object|null} options.byId - document returned by findById
 * @param {Object|null} options.byQuery - document returned by findOne
 * @param {Function} [options.onUpdate] - receives (query, update) for findOneAndUpdate
 */
function loadAuthRouter({ byId, byQuery, onUpdate } = {}) {
  const state = { saved: [], updates: [] };

  const withSave = (doc) => (doc
    ? {
      ...doc,
      // Der echte Schema-Hook hasht bei isModified('password'); der Mock tut es
      // ebenfalls, damit die Assertions das gespeicherte Hash prüfen können.
      save: async function () {
        if (typeof this.password === 'string' && !this.password.startsWith('$2')) {
          this.password = await bcrypt.hash(this.password, 4);
        }
        state.saved.push(this);
        return this;
      },
      toJSON() { return { ...this }; }
    }
    : null);

  const userDoc = withSave(byId);
  const foundDoc = withSave(byQuery === undefined ? byId : byQuery);

  class UserMock {
    constructor(data) { Object.assign(this, data); }
    async save() { state.saved.push(this); return this; }
  }
  UserMock.findById = () => queryLike(userDoc);
  UserMock.findOne = () => queryLike(foundDoc);
  UserMock.findOneAndUpdate = (query, update) => {
    state.updates.push({ query, update });
    const result = onUpdate ? onUpdate(query, update) : { _id: OTHER_ID, username: 'bob', email: 'bob@example.com' };
    return queryLike(result);
  };
  UserMock.countDocuments = async () => 1;

  for (const p of [authRouterPath, adminRouterPath, adminServicePath, userModelPath, authMiddlewarePath]) {
    delete require.cache[p];
  }
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };

  // middleware/auth muss NACH dem User-Mock geladen werden, sonst bindet
  // authenticateToken das echte Modell (ohne DB) und jede Anfrage wird 401.
  const authMiddleware = require(authMiddlewarePath);
  return {
    authRouter: require(authRouterPath),
    adminRouter: require(adminRouterPath),
    state,
    generateToken: authMiddleware.generateToken
  };
}

async function withServer(routers, run) {
  const app = express();
  app.use(express.json());
  // authenticateToken liest req.cookies — ohne cookie-parser ist jede Sitzung 401.
  app.use(cookieParser());
  app.use('/api/auth', routers.authRouter);
  if (routers.adminRouter) {
    // The admin router authenticates and requires admin rights itself.
    app.use('/api/admin', routers.adminRouter);
  }
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [authRouterPath, adminRouterPath, adminServicePath, userModelPath, authMiddlewarePath]) {
      delete require.cache[p];
    }
  }
}

async function post(base, path, body, sessionCookie) {
  const headers = { 'content-type': 'application/json' };
  if (sessionCookie) headers.cookie = `kl_session=${sessionCookie}`;
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

const sessionCookieFor = (userId = USER_ID, sessionVersion = 0) =>
  generateToken(userId, sessionVersion);

// ---------------------------------------------------------------------------
// token helper
// ---------------------------------------------------------------------------

test('reset tokens are random, hashed for storage and expire after 15 minutes', () => {
  const first = createPasswordResetToken();
  const second = createPasswordResetToken();

  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashPasswordResetToken(first.token));
  assert.notEqual(first.tokenHash, first.token, 'the raw token must never be stored');
  assert.equal(RESET_TOKEN_TTL_MS, 15 * 60 * 1000);
  const ttl = first.expiresAt.getTime() - Date.now();
  assert.ok(ttl > 14 * 60 * 1000 && ttl <= 15 * 60 * 1000, `unexpected ttl ${ttl}`);
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------

test('change-password rejects a wrong current password', async () => {
  const { authRouter } = loadAuthRouter({ byId: { _id: USER_ID, password: CURRENT_HASH, sessionVersion: 0, username: 'alice', email: 'a@example.com' } });

  await withServer({ authRouter }, async base => {
    const { status, body } = await post(base, '/api/auth/change-password', {
      currentPassword: 'Falsch123x',
      newPassword: 'Neu12345x'
    }, sessionCookieFor());

    assert.equal(status, 401);
    assert.equal(body.code, 'CURRENT_PASSWORD_INVALID');
  });
});

test('change-password rejects a weak or unchanged password', async () => {
  const { authRouter, state } = loadAuthRouter({ byId: { _id: USER_ID, password: CURRENT_HASH, sessionVersion: 0, username: 'alice', email: 'a@example.com' } });

  await withServer({ authRouter }, async base => {
    const weak = await post(base, '/api/auth/change-password', {
      currentPassword: CURRENT_PASSWORD,
      newPassword: 'nurklein'
    }, sessionCookieFor());
    assert.equal(weak.status, 400);

    const same = await post(base, '/api/auth/change-password', {
      currentPassword: CURRENT_PASSWORD,
      newPassword: CURRENT_PASSWORD
    }, sessionCookieFor());
    assert.equal(same.status, 400);
    assert.equal(same.body.code, 'PASSWORD_UNCHANGED');
    assert.equal(state.saved.length, 0, 'nothing may be saved for rejected changes');
  });
});

test('change-password stores a new hash, bumps sessionVersion and re-issues the cookie', async () => {
  const { authRouter, state } = loadAuthRouter({ byId: { _id: USER_ID, password: CURRENT_HASH, sessionVersion: 3, username: 'alice', email: 'a@example.com' } });

  await withServer({ authRouter }, async base => {
    const { status, body, headers } = await post(base, '/api/auth/change-password', {
      currentPassword: CURRENT_PASSWORD,
      newPassword: 'Neu12345x'
    }, sessionCookieFor(USER_ID, 3));

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(state.saved.length, 1);
    assert.equal(state.saved[0].sessionVersion, 4, 'other sessions must be invalidated');
    assert.equal(await bcrypt.compare('Neu12345x', state.saved[0].password), true, 'password is hashed by the model hook');

    const setCookie = headers.getSetCookie?.() || [];
    assert.ok(setCookie.some(cookie => cookie.startsWith('kl_session=')), 'the current session gets a fresh cookie');
    const token = setCookie.find(cookie => cookie.startsWith('kl_session='))?.split(';')[0].split('=')[1];
    const decoded = require('jsonwebtoken').decode(token);
    assert.equal(decoded.sessionVersion, 4);
    assert.equal(body.user.password, undefined, 'the response must not leak the hash');
  });
});

test('change-password refuses OAuth accounts without a local password', async () => {
  const { authRouter } = loadAuthRouter({ byId: { _id: USER_ID, password: null, provider: 'google', sessionVersion: 0, username: 'alice', email: 'a@example.com' } });

  await withServer({ authRouter }, async base => {
    const { status, body } = await post(base, '/api/auth/change-password', {
      currentPassword: 'irrelevant',
      newPassword: 'Neu12345x'
    }, sessionCookieFor());

    assert.equal(status, 400);
    assert.equal(body.code, 'PASSWORD_NOT_SET');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------------------

test('reset-password redeems a valid token once and invalidates sessions', async () => {
  const { token, tokenHash, expiresAt } = createPasswordResetToken();
  const stored = {
    _id: OTHER_ID,
    username: 'bob',
    email: 'bob@example.com',
    password: bcrypt.hashSync('Bobby1234x', 4),
    sessionVersion: 1,
    passwordResetToken: tokenHash,
    passwordResetExpires: expiresAt
  };
  const { authRouter, state } = loadAuthRouter({ byQuery: stored });

  await withServer({ authRouter }, async base => {
    const { status, body } = await post(base, '/api/auth/reset-password', { token, newPassword: 'BobNeu1234x' });

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(state.saved.length, 1);
    assert.equal(state.saved[0].sessionVersion, 2);
    assert.equal(state.saved[0].passwordResetToken, null, 'the token must be cleared');
    assert.equal(state.saved[0].passwordResetExpires, null);
    assert.equal(await bcrypt.compare('BobNeu1234x', state.saved[0].password), true);
  });
});

test('reset-password rejects unknown, expired and malformed tokens', async () => {
  const expired = createPasswordResetToken();
  expired.expiresAt = new Date(Date.now() - 1000);

  // findOne filters on { passwordResetToken, passwordResetExpires: { $gt: now } }
  // so an expired or unknown token simply finds nobody.
  const { authRouter, state } = loadAuthRouter({ byQuery: null });

  await withServer({ authRouter }, async base => {
    const unknown = await post(base, '/api/auth/reset-password', { token: 'a'.repeat(64), newPassword: 'BobNeu1234x' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, 'RESET_TOKEN_INVALID');

    const tooShort = await post(base, '/api/auth/reset-password', { token: 'short', newPassword: 'BobNeu1234x' });
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.body.error, 'Validierungsfehler');

    const weak = await post(base, '/api/auth/reset-password', { token: 'a'.repeat(64), newPassword: 'schwach' });
    assert.equal(weak.status, 400);
    assert.equal(state.saved.length, 0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/password-reset
// ---------------------------------------------------------------------------

const ADMIN_DOC = { _id: USER_ID, username: 'alice', email: 'a@example.com', isAdmin: true, sessionVersion: 0 };

test('admin creates a reset token and stores only its hash', async () => {
  const { authRouter, adminRouter, state } = loadAuthRouter({ byId: ADMIN_DOC });

  await withServer({ authRouter, adminRouter }, async base => {
    const response = await fetch(`${base}/api/admin/users/${OTHER_ID}/password-reset`, {
      method: 'POST',
      headers: { cookie: `kl_session=${sessionCookieFor(USER_ID, 0)}` }
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.match(body.resetToken, /^[a-f0-9]{64}$/);
    assert.equal(state.updates.length, 1);
    const update = state.updates[0].update;
    assert.equal(update.passwordResetToken, hashPasswordResetToken(body.resetToken));
    assert.notEqual(update.passwordResetToken, body.resetToken, 'the raw token must not be stored');
    assert.ok(update.passwordResetExpires instanceof Date);
    assert.equal(body.user.username, 'bob');
  });
});

test('admin cannot create a reset token for the own account', async () => {
  const { authRouter, adminRouter, state } = loadAuthRouter({ byId: ADMIN_DOC });

  await withServer({ authRouter, adminRouter }, async base => {
    const response = await fetch(`${base}/api/admin/users/${USER_ID}/password-reset`, {
      method: 'POST',
      headers: { cookie: `kl_session=${sessionCookieFor(USER_ID, 0)}` }
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /eigene Konto/);
    assert.equal(state.updates.length, 0);
  });
});

test('admin reset token creation rejects invalid ids and missing users', async () => {
  const { authRouter, adminRouter } = loadAuthRouter({ byId: ADMIN_DOC, onUpdate: () => null });

  await withServer({ authRouter, adminRouter }, async base => {
    const headers = { cookie: `kl_session=${sessionCookieFor(USER_ID, 0)}` };
    const invalid = await fetch(`${base}/api/admin/users/not-an-id/password-reset`, { method: 'POST', headers });
    assert.equal(invalid.status, 400);

    const missing = await fetch(`${base}/api/admin/users/${OTHER_ID}/password-reset`, { method: 'POST', headers });
    assert.equal(missing.status, 404);
  });
});
