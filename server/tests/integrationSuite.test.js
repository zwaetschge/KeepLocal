const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 23): Die Server-Suite lief vollständig gegen
// gemockte Modelle, MongoDB-Semantik war prinzipiell ungeprüft. Die neue
// `tests-integration/`-Suite läuft gegen eine echte Datenbank — dieser Test hält
// die Verdrahtung fest, damit sie nicht still aus der CI verschwindet.

const root = path.resolve(__dirname, '../..');

test('CI runs the integration suite against a real MongoDB', () => {
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const job = ci.match(/\n  server-integration:\n([\s\S]*?)\n  e2e:\n/)?.[1] || '';

  assert.ok(job, 'the server-integration job must exist');
  assert.match(job, /image: mongo:7/, 'it needs a real database, not a mock');
  assert.match(job, /working-directory: server\n\s+run: npm ci/);
  assert.match(job, /INTEGRATION_MONGODB_URI: mongodb:\/\/127\.0\.0\.1:27017\/keeplocal_integration/);
  assert.match(job, /run: npm run test:integration/);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:integration'], 'node --test tests-integration/*.test.js');
  assert.notEqual(pkg.scripts.test, pkg.scripts['test:integration'],
    'the unit suite must stay runnable without a database');
});

test('the integration suite refuses databases that do not look like test data', () => {
  const harness = fs.readFileSync(path.join(__dirname, '../tests-integration/harness.js'), 'utf8');

  assert.match(harness, /integration\|e2e\|test\|ci/i);
  assert.match(harness, /refusing to drop database/);
  assert.match(harness, /dropDatabase\(\)/);
  assert.match(harness, /syncIndexes\(\)/, 'indexes are created the way the server startup does');
  assert.match(harness, /models\(\);/, 'the models must be loaded before syncing, mongoose.models starts empty');
});

test('every integration test is skipped without a database, never half-run', () => {
  const suite = fs.readFileSync(path.join(__dirname, '../tests-integration/mongodb.test.js'), 'utf8');
  const testCount = (suite.match(/^test\(/gm) || []).length;
  const guarded = (suite.match(/\{ skip \}/g) || []).length;

  assert.ok(testCount >= 9, `expected the full suite, found ${testCount} tests`);
  assert.equal(guarded, testCount, 'every test must carry the skip guard');
  assert.match(suite, /const skip = INTEGRATION_URI \? false : /);
});

test('the integration suite covers the semantics mocks cannot prove', () => {
  const suite = fs.readFileSync(path.join(__dirname, '../tests-integration/mongodb.test.js'), 'utf8');

  for (const topic of [
    'images.filename_1',            // COLLSCAN pro Thumbnail (Nr. 11)
    'trash_ttl',                    // TTL-Backstop hinter dem Janitor (Nr. 5)
    'note_text_search',             // gewichtete Suche
    'provider_1_providerId_1',      // unique + partial
    'single_bootstrap_admin',
    'duplicate key error',          // echte Unique-Verletzungen
    'COLLSCAN',                     // explain() auf dem Hot Path
    'IXSCAN',
    '\\$expr',                       // Bild-Limit über die Datenbank
    'purgeExpiredTrash'             // Janitor gegen echte Dateien
  ]) {
    assert.match(suite, new RegExp(topic), `the suite must cover ${topic}`);
  }
});
