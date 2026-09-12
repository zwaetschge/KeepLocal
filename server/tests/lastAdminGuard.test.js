const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 8): Admin-Rechte liessen sich ohne
// "mindestens ein Admin bleibt"-Guard entziehen (und der letzte Admin konnte
// den anderen loeschen). Fatal ist das wegen des Recovery-Designs:
// Passwort-Reset-Tokens erzeugt nur ein Admin (routes/admin.js hinter
// requireAdmin), einen SMTP-Pfad gibt es nicht — ohne Admin ist die Instanz von
// der UI aus nicht mehr zu retten.

const userModelPath = require.resolve('../models/User');
const noteModelPath = require.resolve('../models/Note');
const apiKeyModelPath = require.resolve('../models/ApiKey');
const settingsModelPath = require.resolve('../models/Settings');
const servicePath = require.resolve('../services/adminService');

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function loadService({ admins = 1, target } = {}) {
  const saved = [];
  const UserMock = {
    findById: async (id) => (String(id) === OTHER && target ? target : null),
    countDocuments: async (filter) => {
      // "remaining admins" = admins minus the target itself
      if (filter && filter.isAdmin === true && filter._id?.$ne) {
        return Math.max(0, admins - 1);
      }
      return admins;
    },
    updateOne: async () => ({ acknowledged: true, modifiedCount: 1 }),
    updateMany: async () => ({ acknowledged: true, modifiedCount: 0 }),
    findByIdAndDelete: async (id) => (String(id) === OTHER ? { _id: OTHER } : null)
  };
  const targetDocument = target && {
    ...target,
    save: async function save() { saved.push({ isAdmin: this.isAdmin, isBootstrapAdmin: this.isBootstrapAdmin }); return this; },
    toObject() { return { ...this }; }
  };
  if (targetDocument) UserMock.findById = async (id) => (String(id) === OTHER ? targetDocument : null);

  delete require.cache[servicePath];
  for (const [modulePath, exports] of [
    [userModelPath, UserMock],
    [noteModelPath, { find: async () => [], updateMany: async () => ({}), deleteMany: async () => ({}), countDocuments: async () => 0 }],
    [apiKeyModelPath, { deleteMany: async () => ({}) }],
    [settingsModelPath, { findById: async () => null }]
  ]) {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  return { service: require(servicePath), saved };
}

test('revoking admin rights is refused when no other admin is left', async () => {
  const { service, saved } = loadService({ admins: 1, target: { _id: OTHER, username: 'bob', isAdmin: true, isBootstrapAdmin: true } });

  await assert.rejects(
    service.toggleUserAdmin(OTHER, ME),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'LAST_ADMIN');
      assert.match(error.message, /Mindestens ein Administrator/);
      return true;
    }
  );
  assert.equal(saved.length, 0, 'nothing may be written when the guard trips');
});

test('deleting the last admin is refused too', async () => {
  const { service } = loadService({ admins: 1, target: { _id: OTHER, username: 'bob', isAdmin: true } });

  await assert.rejects(
    service.deleteUser(OTHER, ME),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'LAST_ADMIN');
      return true;
    }
  );
});

test('with a second admin, revoking works and frees the bootstrap index', async () => {
  const { service, saved } = loadService({ admins: 2, target: { _id: OTHER, username: 'bob', isAdmin: true, isBootstrapAdmin: true } });

  const result = await service.toggleUserAdmin(OTHER, ME);

  assert.equal(result.isAdmin, false);
  assert.equal(result.isBootstrapAdmin, false, 'the unique single_bootstrap_admin index must be released');
  // Two writes on purpose: the demotion lands first and is verified (a
  // concurrent demotion may still roll it back), the bootstrap flag is only
  // released once the demotion is final.
  assert.equal(saved.length, 2, 'demotion and bootstrap release are separate writes');
  assert.deepEqual(saved[0], { isAdmin: false, isBootstrapAdmin: true });
  assert.deepEqual(saved[1], { isAdmin: false, isBootstrapAdmin: false });
  assert.equal(result.password, undefined, 'the password hash never leaves the service');
});

test('promoting a non-admin is never blocked', async () => {
  const { service, saved } = loadService({ admins: 1, target: { _id: OTHER, username: 'bob', isAdmin: false, isBootstrapAdmin: false } });

  const result = await service.toggleUserAdmin(OTHER, ME);

  assert.equal(result.isAdmin, true);
  assert.equal(result.isBootstrapAdmin, false, 'promoting must not claim the unique bootstrap slot');
  assert.equal(saved.length, 1);
});

test('deleting a normal user stays possible with a single admin', async () => {
  const { service } = loadService({ admins: 1, target: { _id: OTHER, username: 'bob', isAdmin: false } });

  const deleted = await service.deleteUser(OTHER, ME);
  assert.equal(deleted.username, 'bob');
});

test('the guard has a stable error code and a translated message', () => {
  const { MESSAGE_TO_CODE } = require('../constants/errorCodes');
  const { errorMessages } = require('../constants');

  assert.equal(MESSAGE_TO_CODE[errorMessages.ADMIN.LAST_ADMIN], 'LAST_ADMIN');

  const apiErrors = fs.readFileSync(path.join(__dirname, '../../client/src/utils/apiErrors.mjs'), 'utf8');
  assert.match(apiErrors, /LAST_ADMIN: 'errLastAdmin'/);
  for (const file of ['de.js', 'en.js']) {
    const translations = fs.readFileSync(path.join(__dirname, '../../client/src/translations', file), 'utf8');
    assert.match(translations, /errLastAdmin:/, `${file} must translate LAST_ADMIN`);
  }
});

test('the admin route uses the service instead of flipping the flag inline', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');

  assert.match(route, /await adminService\.toggleUserAdmin\(id, req\.user\._id\.toString\(\)\)/);
  assert.doesNotMatch(route, /user\.isAdmin = !user\.isAdmin/, 'the toggle must live in one place');
  assert.match(route, /if \(error\.statusCode\) \{\s*return res\.status\(error\.statusCode\)\.json\(\{ error: error\.message \}\);/,
    'a 409 from the guard must reach the client, not a generic 500');
});

test('a documented recovery path exists for a locked-out instance', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/promote-admin.js'), 'utf8');

  assert.match(script, /\$set: \{ isAdmin: true \}/);
  assert.match(script, /--dry-run/);
  assert.match(script, /select\('-password'\)/, 'the script must never load password hashes');
  assert.doesNotMatch(script, /isBootstrapAdmin: true/, 'the unique bootstrap slot must stay untouched');

  const dockerDocs = fs.readFileSync(path.join(__dirname, '../../docs/docker.md'), 'utf8');
  assert.match(dockerDocs, /promote-admin\.js/, 'operators must be able to find the recovery tool');
});

// ---------------------------------------------------------------------------
// The race that a pure pre-check cannot see: two admins revoke each other at the
// same time. Verified against a real MongoDB (scripts/verify-admin-guard.js) —
// check-then-act left ZERO admins behind. The demotion therefore runs first and
// is verified afterwards; whoever sees an empty admin set rolls their own change
// back. This test pins the worst interleaving with a barrier in the mock.
// ---------------------------------------------------------------------------

function loadRaceService() {
  const store = {
    a: { _id: 'a', username: 'adminA', isAdmin: true, isBootstrapAdmin: true },
    b: { _id: 'b', username: 'adminB', isAdmin: true, isBootstrapAdmin: false }
  };
  const saves = [];
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let arrived = 0;

  const makeDoc = (id) => ({
    ...store[id],
    async save() {
      // Hold both demotions until both have arrived: guaranteed worst case.
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      store[id] = { ...store[id], isAdmin: this.isAdmin, isBootstrapAdmin: this.isBootstrapAdmin };
      saves.push({ id, isAdmin: this.isAdmin });
      return this;
    },
    toObject() {
      return { ...store[id] };
    }
  });

  const UserMock = {
    findById: async (id) => (store[String(id)] ? makeDoc(String(id)) : null),
    countDocuments: async (filter = {}) => Object.entries(store)
      .filter(([id, user]) => user.isAdmin && (!filter._id?.$ne || String(filter._id.$ne) !== id))
      .length,
    updateOne: async () => ({ acknowledged: true, modifiedCount: 1 })
  };

  delete require.cache[servicePath];
  for (const [modulePath, exports] of [
    [userModelPath, UserMock],
    [noteModelPath, { find: async () => [], updateMany: async () => ({}), deleteMany: async () => ({}), countDocuments: async () => 0 }],
    [apiKeyModelPath, { deleteMany: async () => ({}) }],
    [settingsModelPath, { findById: async () => null }]
  ]) {
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  return { service: require(servicePath), store, saves };
}

test('two admins revoking each other concurrently cannot leave zero admins', async () => {
  const { service, store, saves } = loadRaceService();

  const results = await Promise.allSettled([
    service.toggleUserAdmin('b', 'a'),
    service.toggleUserAdmin('a', 'b')
  ]);

  const admins = Object.values(store).filter((user) => user.isAdmin).length;
  assert.ok(admins >= 1, `at least one admin must remain, got ${admins}`);

  const refused = results.filter((result) => result.status === 'rejected' && result.reason?.code === 'LAST_ADMIN');
  assert.ok(refused.length >= 1, 'the losing demotion must be refused with LAST_ADMIN');

  // Whoever observed the empty admin set wrote the flag back.
  const restores = saves.filter((entry) => entry.isAdmin === true);
  assert.ok(restores.length >= 1, 'a demotion that emptied the admin set must be rolled back');
  assert.equal(results.filter((result) => result.status === 'fulfilled').length + refused.length, 2);
});

test('CI proves the admin guard against a real MongoDB', () => {
  const ci = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /Admin guard check \(no self-lockout, recovery works\)/);
  assert.match(ci, /run: npm run verify:admin-guard/);
  assert.match(ci, /ADMIN_GUARD_MONGODB_URI: mongodb:\/\/127\.0\.0\.1:27017\/keeplocal_adminguard/);

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['verify:admin-guard'], 'node scripts/verify-admin-guard.js');

  const script = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-admin-guard.js'), 'utf8');
  assert.match(script, /Promise\.allSettled/, 'the concurrent demotion must be part of the check');
  assert.match(script, /adminsAfterRace >= 1/);
  assert.match(script, /promote-admin\.js/, 'the recovery tool must be exercised, not just read');
  assert.match(script, /guard\|e2e\|test\|ci/, 'refuses to drop a database that is not a test database');
});
