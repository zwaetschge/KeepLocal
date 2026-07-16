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
