const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('browser auth routes require CSRF and never expose JWTs in JSON', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');

  assert.match(server, /app\.use\('\/api\/auth',\s*csrfProtection,\s*authRouter\)/);
  assert.doesNotMatch(routes, /\n\s*token,\s*\n\s*user:/);
});

test('cookie sessions are revocable and are not accepted from Authorization headers', () => {
  const middleware = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
  const userModel = fs.readFileSync(path.join(root, 'models/User.js'), 'utf8');

  assert.match(userModel, /sessionVersion/);
  assert.match(middleware, /decoded\.sessionVersion/);
  assert.match(middleware, /user\.sessionVersion/);
  assert.doesNotMatch(middleware, /headers\[['"]authorization['"]\]/i);
});

test('authentication input has a bounded password length and generic failures', () => {
  const routes = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');

  assert.match(routes, /isLength\(\{ min: 8, max: 128 \}\)/);
  assert.match(routes, /DUMMY_PASSWORD_HASH/);
  assert.doesNotMatch(routes, /Dieses Konto verwendet/);
  assert.match(routes, /Benutzername oder E-Mail-Adresse bereits vergeben/);
});

test('only one concurrent bootstrap registration can become the initial admin', () => {
  const userModel = require('../models/User');
  const indexes = userModel.schema.indexes();
  const bootstrapIndex = indexes.find(([, options]) => options.name === 'single_bootstrap_admin');

  assert.ok(bootstrapIndex, 'bootstrap admin marker needs a unique partial index');
  assert.equal(bootstrapIndex[1].unique, true);
  assert.deepEqual(bootstrapIndex[1].partialFilterExpression, { isBootstrapAdmin: true });

  const passwordRoute = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
  const oauth = fs.readFileSync(path.join(root, 'config/passport.js'), 'utf8');
  assert.match(passwordRoute, /isBootstrapAdmin:\s*isFirstUser/);
  assert.match(oauth, /isBootstrapAdmin:\s*isFirstUser/);
});

test('production CORS does not trust an arbitrary matching Host header', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /process\.env\.NODE_ENV !== 'production'[\s\S]*?new URL\(origin\)\.host === requestHost/);
  assert.match(server, /express\.json\(\{ limit: '1mb' \}\)/);
});

// ---------------------------------------------------------------------------
// Audit 2026-09-12 (Top-30 Nr. 19): the linking path must actually verify the
// email it links with. passport-github2 without `allRawEmails` collapses
// GET /user/emails to the primary address and drops `verified`, so the check
// used to reject every GitHub login of an existing local account — and a
// careless "fix" (dropping the check) would have opened account takeover.
// These tests execute the real findOrCreateOAuthUser with a mocked User model.
// ---------------------------------------------------------------------------

const passportModulePath = require.resolve('../config/passport');
const userModulePath = require.resolve('../models/User');
const settingsModulePath = require.resolve('../models/Settings');

function loadPassportWithUsers(usersByIdentity) {
  for (const p of [passportModulePath, userModulePath, settingsModulePath]) {
    delete require.cache[p];
  }
  const store = { users: usersByIdentity, saved: [] };
  const findInStore = (query) => {
    if (query.provider && query.providerId) {
      return store.users.find(u => u.provider === query.provider && u.providerId === query.providerId) || null;
    }
    return store.users.find(u => u.email === query.email) || null;
  };
  require.cache[userModulePath] = {
    id: userModulePath, filename: userModulePath, loaded: true,
    exports: {
      // passport.js chains .select('+sessionVersion'); keep the chain fluent.
      findOne: (query) => ({ select: async () => findInStore(query) }),
      countDocuments: async () => store.users.length,
    }
  };
  require.cache[settingsModulePath] = {
    id: settingsModulePath, filename: settingsModulePath, loaded: true,
    exports: { findById: async () => ({ registrationEnabled: true }) }
  };
  const { findOrCreateOAuthUser } = require(passportModulePath);
  return { findOrCreateOAuthUser, store };
}

/** Minimal user record whose save() records itself and reports linkage. */
function localAccountWithEmail(email) {
  return {
    username: 'existing', email, provider: 'local', providerId: null, avatar: null,
    save: async function save() { storeRef.saved.push(this); return this; }
  };
}

let storeRef;
const GH_ID = 'gh-42';

test('GitHub links an existing local account only with a verified email', async () => {
  storeRef = { users: [localAccountWithEmail('user@example.com')], saved: [] };
  const { findOrCreateOAuthUser } = loadPassportWithUsers(storeRef.users);

  const linked = await findOrCreateOAuthUser('github', {
    id: GH_ID,
    username: 'octocat',
    emails: [{ value: 'user@example.com', verified: true, primary: true }],
  });
  assert.equal(linked.email, 'user@example.com');
  assert.equal(linked.provider, 'github');
  assert.equal(linked.providerId, GH_ID);
  assert.equal(storeRef.saved.length, 1, 'the existing account is linked in place');
});

test('an unverified GitHub email never links the existing account', async () => {
  storeRef = { users: [localAccountWithEmail('user@example.com')], saved: [] };
  const { findOrCreateOAuthUser } = loadPassportWithUsers(storeRef.users);

  await assert.rejects(
    findOrCreateOAuthUser('github', {
      id: GH_ID,
      username: 'octocat',
      emails: [{ value: 'user@example.com', verified: false, primary: true }],
    }),
    /must be verified/,
    'the unverified primary address must not grant access to the local account'
  );
  assert.equal(storeRef.saved.length, 0, 'nothing may be written');
});

test('a GitHub-style profile never passes verification through Google-only fields', async () => {
  storeRef = { users: [localAccountWithEmail('user@example.com')], saved: [] };
  const { findOrCreateOAuthUser } = loadPassportWithUsers(storeRef.users);

  // A forged/hijacked /user payload could set email_verified even though the
  // /user/emails entry says otherwise — the GitHub path must ignore it.
  await assert.rejects(
    findOrCreateOAuthUser('github', {
      id: GH_ID,
      username: 'octocat',
      emails: [{ value: 'user@example.com', verified: false, primary: true }],
      _json: { email: 'user@example.com', email_verified: true },
    }),
    /must be verified/
  );
});

test('with two emails only the non-primary verified, the verified one is chosen', async () => {
  storeRef = { users: [localAccountWithEmail('secondary@example.com')], saved: [] };
  const { findOrCreateOAuthUser } = loadPassportWithUsers(storeRef.users);

  const linked = await findOrCreateOAuthUser('github', {
    id: GH_ID,
    username: 'octocat',
    emails: [
      { value: 'unverified-primary@example.com', verified: false, primary: true },
      { value: 'secondary@example.com', verified: true, primary: false },
    ],
  });
  // The verified secondary address is the one looked up and linked — the
  // previous code blindly took emails[0].
  assert.equal(linked.email, 'secondary@example.com');
  assert.equal(linked.providerId, GH_ID);
});

test('Google keeps accepting the provider-reported verification flag', async () => {
  storeRef = { users: [localAccountWithEmail('user@example.com')], saved: [] };
  const { findOrCreateOAuthUser } = loadPassportWithUsers(storeRef.users);

  const linked = await findOrCreateOAuthUser('google', {
    id: 'google-7',
    displayName: 'G',
    emails: [{ value: 'user@example.com', verified: true }],
    _json: { email: 'user@example.com', email_verified: true },
  });
  assert.equal(linked.provider, 'google');
  assert.equal(linked.providerId, 'google-7');
});

test('the GitHub strategy is configured to keep the raw email flags', () => {
  const source = fs.readFileSync(path.join(root, 'config/passport.js'), 'utf8');
  assert.match(source, /allRawEmails:\s*true/);

  const route = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
  assert.match(route, /error\?\.code === 'oauth_email_unverified' \? 'oauth_email_unverified' : errorCode/);

  for (const file of ['de.js', 'en.js']) {
    const translations = fs.readFileSync(path.join(root, '..', 'client', 'src', 'translations', file), 'utf8');
    assert.match(translations, /oauthEmailUnverified:/, `${file} needs the specific unverified-email message`);
  }
  const callback = fs.readFileSync(path.join(root, '..', 'client', 'src', 'components', 'OAuthCallback.jsx'), 'utf8');
  assert.match(callback, /'oauth_email_unverified' \? 'oauthEmailUnverified' : 'oauthFailed'/);
});

test('a provider sign-in without any usable email is rejected', async () => {
  storeRef = { users: [], saved: [] };
  const { findOrCreateOAuthUser } = loadPassportWithUsers(storeRef.users);

  await assert.rejects(
    findOrCreateOAuthUser('github', { id: GH_ID, username: 'octocat', emails: [] }),
    /did not return an email/
  );
});
