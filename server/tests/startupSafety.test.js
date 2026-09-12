const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const databaseSource = fs.readFileSync(path.resolve(__dirname, '../config/database.js'), 'utf8');
// entrypoint.sh lives in the repository root, not in server/.
const entrypointSource = fs.readFileSync(path.resolve(__dirname, '../../entrypoint.sh'), 'utf8');

test('HTTP starts only after MongoDB connects and indexes are ready', () => {
  assert.match(serverSource, /async function startServer\(\)[\s\S]*?await connectDB\(\)[\s\S]*?syncIndexes\(\)[\s\S]*?app\.listen/);
  assert.match(serverSource, /if \(require\.main === module\)/);
  assert.doesNotMatch(databaseSource, /process\.exit/);
});

// Upgrades from an older image can carry indexes whose NAME stayed the same
// while their options changed (provider_1_providerId_1 became unique+partial).
// createIndex() then aborts with "An existing index has the same name as the
// requested index", model.init() rejects and the container crash-loops although
// the data is fine — observed live while updating a July image to main.
test('startup synchronises indexes instead of only creating missing ones', () => {
  assert.match(serverSource, /await model\.syncIndexes\(\)/);
  assert.doesNotMatch(serverSource, /model\.init\(\)\)/, 'init() alone cannot resolve option conflicts');
  assert.match(serverSource, /dropped/, 'dropped indexes are logged');
  // Der Text-Index-Sonderfall bleibt vorgeschaltet (ein Text-Index pro Collection).
  const migrationIndex = serverSource.indexOf('ensureNoteTextIndex(mongoose.connection)');
  const syncIndex = serverSource.indexOf('model.syncIndexes()');
  assert.ok(migrationIndex > -1 && syncIndex > migrationIndex, 'the text index migration runs first');
});

test('the entrypoint repairs ownership recursively, not just the top directory', () => {
  // A single root-owned file (e.g. after maintenance with `docker run -u root`)
  // makes mongod exit 14 forever while /data/db itself looks correct.
  assert.match(entrypointSource, /find \/data\/db ! -user mongodb -print -quit/);
  assert.match(entrypointSource, /find \/app\/server\/uploads ! -user node -print -quit/);
  assert.match(entrypointSource, /chown -R mongodb:mongodb \/data\/db/);
  assert.match(entrypointSource, /chown -R node:node \/app\/server\/uploads/);
});

test('CI proves the upgrade boot against a real MongoDB', () => {
  // Source-Scans alone hätten den Crash-Loop nicht gefunden: Der Fehler entsteht
  // erst aus dem Zusammenspiel von neuem Code und alter Index-Definition in der
  // Datenbank. Deshalb fährt die CI den echten Server gegen eine MongoDB mit
  // Juli-Index-Layout (scripts/verify-upgrade-boot.js).
  const ci = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /Upgrade boot check \(legacy index layout\)/);
  assert.match(ci, /run: npm run verify:upgrade-boot/);
  assert.match(ci, /UPGRADE_MONGODB_URI: mongodb:\/\/127\.0\.0\.1:27017\/keeplocal_upgrade/);

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['verify:upgrade-boot'], 'node scripts/verify-upgrade-boot.js');

  const script = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-upgrade-boot.js'), 'utf8');
  assert.match(script, /users\.createIndex\(\{ provider: 1, providerId: 1 \}\)/, 'seeds the legacy non-unique index');
  assert.match(script, /upgrade\|e2e\|test\|ci/, 'refuses to drop a database that is not a test database');
  assert.match(script, /\/api\/health\/ready/, 'waits for real readiness, not just for the port');
});

test('health endpoint reports database disconnects', () => {
  // Improvement #10: the checks moved into services/healthService.js and go
  // beyond mongoose's cached readyState (real ping, writable uploads, AI probe).
  assert.match(serverSource, /const \{ collectHealth \} = require\('\.\/services\/healthService'\);/);
  assert.match(serverSource, /res\.status\(health\.ready \? 200 : 503\)/);
  assert.match(serverSource, /database: health\.database\.status/);

  const healthSource = fs.readFileSync(path.join(__dirname, '../services/healthService.js'), 'utf8');
  assert.match(healthSource, /mongoose\.connection\.readyState !== 1/);
  assert.match(healthSource, /mongoose\.connection\.db\.admin\(\)\.ping\(\)/);
});

test('server shuts down gracefully on SIGTERM and SIGINT', () => {
  assert.match(serverSource, /process\.on\('SIGTERM'/);
  assert.match(serverSource, /process\.on\('SIGINT'/);
  // Laufende Requests abschließen, DB schließen, aber nie endlos hängen bleiben.
  assert.match(serverSource, /httpServer\.close\(/);
  assert.match(serverSource, /mongoose\.connection\.close\(/);
  assert.match(serverSource, /setTimeout\([\s\S]*?,\s*10000\)/);
});

test('API documentation stays disabled in production unless explicitly enabled', () => {
  // Alle Deployment-Varianten setzen NODE_ENV=production — Swagger darf dort
  // nicht ohne Opt-in exponiert werden.
  assert.match(serverSource, /ENABLE_API_DOCS === 'true'/);
  assert.match(serverSource, /ENABLE_API_DOCS !== 'false' && process\.env\.NODE_ENV !== 'production'/);
  // Beide Dokumentations-Routen müssen innerhalb des Gates liegen.
  const gate = serverSource.match(/const apiDocsEnabled[\s\S]*?\n\}/);
  assert.ok(gate, 'apiDocsEnabled gate must exist');
  assert.match(gate[0], /app\.use\('\/api\/docs', swaggerUi/);
  assert.match(gate[0], /app\.get\('\/api\/docs\.json'/);
});
