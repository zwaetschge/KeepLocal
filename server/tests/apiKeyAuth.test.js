const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Audit 2026-09-12 (Top-30 Nr. 21): `middleware/apiKeyAuth.js` ist das einzige
// Tor zur externen /api/v1-API und `models/ApiKey.js` erzeugt die Schlüssel —
// beide hatten keinen einzigen automatisierten Test. Geprüft wurde das pro
// Audit-Runde von Hand (BUG_REPORT_2026-09-10 „Geprüft und für gut befunden").

const apiKeyModelPath = require.resolve('../models/ApiKey');
const userModelPath = require.resolve('../models/User');
const middlewarePath = require.resolve('../middleware/apiKeyAuth');

function loadMiddleware({ keyDoc = null, user = { _id: 'user-1', username: 'api' }, usageFails = false } = {}) {
  const captured = { findByKeyArgs: [], updateOneCalls: 0 };

  const ApiKeyMock = {
    findByKey: async (rawKey) => { captured.findByKeyArgs.push(rawKey); return keyDoc; },
    updateOne: () => {
      captured.updateOneCalls += 1;
      return {
        exec: async () => {
          if (usageFails) throw new Error('write concern failed');
          return { acknowledged: true };
        }
      };
    }
  };
  const UserMock = { findById: () => ({ select: async () => user }) };

  for (const modulePath of [middlewarePath]) delete require.cache[modulePath];
  require.cache[apiKeyModelPath] = { id: apiKeyModelPath, filename: apiKeyModelPath, loaded: true, exports: ApiKeyMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };

  const { authenticateApiKey } = require(middlewarePath);

  const call = (headers) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('middleware neither answered nor continued')), 2000);
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; clearTimeout(timer); resolve({ status: this.statusCode, body: payload, req: reqRef.req }); return this; }
    };
    const reqRef = { req: { headers } };
    authenticateApiKey(reqRef.req, res, (error) => {
      clearTimeout(timer);
      resolve({ next: true, error, req: reqRef.req });
    });
  });

  return { call, captured };
}

const validKey = () => ({ _id: 'key-1', userId: 'user-1', prefix: 'kl_abc', expiresAt: null });

test('a missing API key is refused with a stable message', async () => {
  const { call, captured } = loadMiddleware();
  const result = await call({});
  assert.equal(result.status, 401);
  assert.match(result.body.error, /API-Key erforderlich/);
  assert.equal(result.body.success, false);
  assert.equal(captured.findByKeyArgs.length, 0, 'no lookup without a key');
});

test('an unknown key is refused and the lookup uses the raw key only once', async () => {
  const { call, captured } = loadMiddleware({ keyDoc: null });
  const result = await call({ 'x-api-key': 'kl_unknown' });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'Ungültiger API-Key');
  assert.deepEqual(captured.findByKeyArgs, ['kl_unknown'], 'findByKey hashes internally; the middleware never hashes by hand');
});

test('an expired key is refused', async () => {
  const { call } = loadMiddleware({ keyDoc: { ...validKey(), expiresAt: new Date(Date.now() - 1000) } });
  const result = await call({ 'x-api-key': 'kl_expired' });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'API-Key abgelaufen');
});

test('a key whose user is gone is refused', async () => {
  const { call } = loadMiddleware({ keyDoc: validKey(), user: null });
  const result = await call({ 'x-api-key': 'kl_orphan' });
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'Benutzer nicht gefunden');
});

test('a valid key authenticates and exposes user plus key on the request', async () => {
  const { call, captured } = loadMiddleware({ keyDoc: validKey() });
  const result = await call({ 'x-api-key': 'kl_valid' });
  assert.equal(result.next, true);
  assert.equal(result.error, undefined);
  assert.equal(result.req.user.username, 'api');
  assert.equal(result.req.apiKey._id, 'key-1');
  assert.equal(captured.updateOneCalls, 1, 'lastUsedAt is updated');
});

test('a failing lastUsedAt update never breaks the request', async () => {
  const { call } = loadMiddleware({ keyDoc: validKey(), usageFails: true });
  const result = await call({ 'x-api-key': 'kl_valid' });
  assert.equal(result.next, true, 'fire and forget: the API stays usable');
  assert.equal(result.error, undefined);
});

test('generated keys are long, unique, prefixed and stored as a hash', async () => {
  delete require.cache[apiKeyModelPath];
  const ApiKey = require('../models/ApiKey');

  const seen = new Set();
  for (let index = 0; index < 100; index += 1) {
    const { rawKey, hash, prefix } = ApiKey.generateKey();
    assert.match(rawKey, /^kl_[a-f0-9]{64}$/, 'the raw key must be 32 bytes of hex with the kl_ prefix');
    assert.equal(prefix, rawKey.slice(0, 7), 'the prefix is what the UI can show safely');
    assert.equal(hash, crypto.createHash('sha256').update(rawKey).digest('hex'), 'only the hash is stored');
    assert.notEqual(hash, rawKey);
    assert.equal(seen.has(rawKey), false, 'no duplicates');
    seen.add(rawKey);
  }
  assert.equal(seen.size, 100);
});

test('the key lookup requires an active key and hashes the candidate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../models/ApiKey.js'), 'utf8');
  assert.match(source, /apiKeySchema\.statics\.findByKey = async function \(rawKey\)/);
  assert.match(source, /createHash\('sha256'\)\.update\(rawKey\)/);
  assert.match(source, /isActive: true/, 'a revoked key must not authenticate');
  assert.match(source, /return this\.findOne\(\{ key: hash, isActive: true \}\);/, 'the lookup must use the hash, never the raw key');
  assert.doesNotMatch(source, /findOne\(\{ key: rawKey/, 'never look up the raw key');
});

test('the API key middleware is the single gate in front of /api/v1', () => {
  const index = fs.readFileSync(path.join(__dirname, '../routes/v1/index.js'), 'utf8');
  assert.match(index, /router\.use\(authenticateApiKey\);/);
  const gatePosition = index.indexOf('router.use(authenticateApiKey)');
  for (const mount of ["router.use('/notes'", "router.use('/tags'", "router.use('/user'"]) {
    assert.ok(index.indexOf(mount) > gatePosition, `${mount} must sit behind the API key gate`);
  }
});
