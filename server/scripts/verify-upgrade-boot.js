/**
 * Upgrade-Boot-Check: startet den echten Server gegen eine MongoDB, die noch das
 * Index-Layout eines alten Images trägt, und prüft, dass er hochkommt und die
 * Indizes repariert.
 *
 * Warum: Beim Update einer Juli-Installation auf `main` blieb der Container in
 * einer Crash-Schleife. `users.provider_1_providerId_1` war damals nicht
 * eindeutig, ist heute aber unique+partial — gleicher Name, andere Optionen.
 * `createIndex()` bricht damit ab ("An existing index has the same name as the
 * requested index"), `model.init()` rejectet, der Prozess stirbt vor
 * `app.listen()`. Supervisord/Docker starten neu, dieselbe Fehlermeldung, endlos.
 * Die Daten selbst waren völlig in Ordnung. Seit dem Fix ruft der Startup
 * `syncIndexes()` auf; dieser Check hält genau das fest.
 *
 * Usage:
 *   UPGRADE_MONGODB_URI=mongodb://127.0.0.1:27017/keeplocal_upgrade \
 *     node scripts/verify-upgrade-boot.js
 *
 * Safety: läuft nur gegen Datenbanken, deren Name nach Test aussieht
 * (upgrade/e2e/test/ci), sonst nur mit UPGRADE_ALLOW_ANY_DB=1 — der Check
 * droppt die Datenbank zu Beginn.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');

const SERVER_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.UPGRADE_PORT || 5099);
const READY_TIMEOUT_MS = Number(process.env.UPGRADE_TIMEOUT_MS || 90000);
const POLL_INTERVAL_MS = 500;

function resolveUri() {
  const uri = process.env.UPGRADE_MONGODB_URI || process.env.E2E_MONGODB_URI || process.env.MONGODB_URI
    || 'mongodb://127.0.0.1:27017/keeplocal_upgrade';
  const dbName = new URL(uri).pathname.replace(/^\//, '');
  if (!/(upgrade|e2e|test|ci)/i.test(dbName) && process.env.UPGRADE_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `refusing to drop database "${dbName}": name does not look like a test database `
      + '(set UPGRADE_ALLOW_ANY_DB=1 to override)'
    );
  }
  return { uri, dbName };
}

/** Index-Layout des Juli-Images (Commit 3d9c7aa) plus ein paar Nutzdaten. */
async function seedLegacyState(db) {
  await db.dropDatabase();
  const users = db.collection('users');
  const notes = db.collection('notes');
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ username: 1 }, { unique: true });
  // Der eigentliche Konflikt: heute unique + partialFilterExpression.
  await users.createIndex({ provider: 1, providerId: 1 });
  // Alt: ungewichteter Text-Index mit englischer Stopsprache, anderer Name.
  await notes.createIndex({ title: 'text', content: 'text', 'todoItems.text': 'text' });
  await notes.createIndex({ userId: 1, isPinned: -1, isArchived: 1, createdAt: -1 });
  // Verwaister Index aus einer längst entfernten Funktion — muss weggeräumt werden.
  await notes.createIndex({ userId: 1, legacyField: 1 });

  await users.insertOne({
    email: 'upgrade@example.com',
    username: 'upgrade',
    password: '$2a$10$upgradecheckupgradecheckupgradecheckupgradecheckupgra',
    provider: 'local',
    providerId: null,
    role: 'user',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z')
  });
  await notes.insertOne({
    userId: new mongoose.Types.ObjectId(),
    title: 'Bestehende Notiz',
    content: 'Darf das Upgrade überleben',
    tags: ['upgrade'],
    isPinned: false,
    isArchived: false,
    createdAt: new Date('2026-07-01T10:05:00Z'),
    updatedAt: new Date('2026-07-01T10:05:00Z')
  });
}

function startServer(uri) {
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      MONGODB_URI: uri,
      JWT_SECRET: 'upgrade-check-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
      CSRF_SECRET: 'upgrade-check-csrf-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: 'false',
      ENABLE_API_DOCS: 'false',
      AI_FEATURES_DISABLED: 'true',
      LOG_LEVEL: 'info'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  return { child, logs };
}

async function waitForReady(child, logs) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'timeout';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode} before becoming ready\n${logs.join('')}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        return await response.json();
      }
      lastError = `HTTP ${response.status}: ${await response.text()}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`server never became ready (${lastError})\n--- server output ---\n${logs.join('')}`);
}

async function indexByName(db, collection, name) {
  const indexes = await db.collection(collection).indexes();
  return indexes.find((index) => index.name === name) || null;
}

function assert(condition, message, failures) {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

async function main() {
  const { uri, dbName } = resolveUri();
  console.log(`[upgrade-boot] Ziel: ${dbName}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  await seedLegacyState(db);

  const legacyProvider = await indexByName(db, 'users', 'provider_1_providerId_1');
  console.log(`[upgrade-boot] Alt-Zustand: provider_1_providerId_1 unique=${Boolean(legacyProvider?.unique)}`
    + `, Text-Index=${(await db.collection('notes').indexes()).map((i) => i.name).join(',')}`);

  const { child, logs } = startServer(uri);
  const failures = [];
  let health = null;
  try {
    health = await waitForReady(child, logs);
    console.log(`[upgrade-boot] Server ist ready (db=${health.database.status}, uploads=${health.uploads.writable})`);

    const provider = await indexByName(db, 'users', 'provider_1_providerId_1');
    const textSearch = await indexByName(db, 'notes', 'note_text_search');
    const noteIndexes = await db.collection('notes').indexes();

    assert(Boolean(provider), 'users.provider_1_providerId_1 exists after boot', failures);
    assert(provider?.unique === true, 'the provider index is unique again', failures);
    assert(Boolean(provider?.partialFilterExpression), 'the provider index keeps its partial filter', failures);
    assert(Boolean(textSearch), 'notes.note_text_search was created', failures);
    assert(textSearch?.weights?.title === 5, 'the text index carries the title weight', failures);
    assert(textSearch?.default_language === 'none', 'the text index uses the neutral language', failures);
    assert(!noteIndexes.some((i) => i.name === 'title_text_content_text_todoItems.text_text'),
      'the legacy unweighted text index is gone', failures);
    assert(!noteIndexes.some((i) => i.name === 'userId_1_legacyField_1'),
      'an orphaned index from an older version is dropped', failures);
    // Bildauslieferung: ohne diese beiden Indizes ist jeder Thumbnail-Request
    // ein COLLSCAN über die ganze Collection (middleware/secureFileServe.js).
    assert(noteIndexes.some((i) => i.name === 'images.filename_1'),
      'notes.images.filename_1 exists (image serving must not scan)', failures);
    assert(noteIndexes.some((i) => i.name === 'images.thumbnailFilename_1'),
      'notes.images.thumbnailFilename_1 exists (image serving must not scan)', failures);
    assert(noteIndexes.some((i) => i.name === 'files.filename_1'),
      'notes.files.filename_1 exists (attachment serving must not scan)', failures);
    assert(!noteIndexes.some((i) => i.name === 'images.filename_1' && i.unique),
      'the image index must not be unique (a failed unique build would kill startup)', failures);

    const usersLeft = await db.collection('users').countDocuments();
    const notesLeft = await db.collection('notes').countDocuments();
    assert(usersLeft === 1 && notesLeft === 1, 'existing documents survived the index sync', failures);
    assert(logs.join('').includes('indexes synchronised'), 'dropped indexes are logged', failures);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 8000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await mongoose.disconnect();
  }

  if (failures.length > 0) {
    console.error(`[upgrade-boot] FEHLGESCHLAGEN (${failures.length}):\n${logs.join('')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[upgrade-boot] OK — Upgrade von einem Juli-Index-Layout startet und repariert sich selbst');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[upgrade-boot] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main, seedLegacyState, resolveUri };
