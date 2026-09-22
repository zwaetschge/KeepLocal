const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

// Improvement #10: /api/health reported "ok" from mongoose's cached readyState,
// so containers stayed healthy while the database was gone or the uploads volume
// was read-only. Logs also had no correlation id.

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-uploads-'));

// The health service reads its environment at call time, so the variables have
// to stay set for the duration of the test (node:test runs one process per file,
// so nothing leaks into other suites).
function loadHealth(env = {}) {
  const healthPath = require.resolve('../services/healthService');
  delete require.cache[healthPath];
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.AI_FEATURES_DISABLED = 'true';
  delete process.env.REQUIRE_AI_FOR_READY;
  for (const [key, value] of Object.entries(env)) {
    if (value === '') delete process.env[key];
    else process.env[key] = value;
  }
  return require(healthPath);
}

function stubConnection({ readyState = 1, ping } = {}) {
  Object.defineProperty(mongoose.connection, 'readyState', { value: readyState, configurable: true });
  Object.defineProperty(mongoose.connection, 'db', {
    value: { admin: () => ({ ping }) },
    configurable: true
  });
}

test('readiness is ok when the database answers and uploads are writable', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  const health = await loadHealth().collectHealth();

  assert.equal(health.ready, true);
  assert.equal(health.status, 'ok');
  assert.equal(health.database.status, 'connected');
  assert.equal(health.uploads.writable, true);
  assert.equal(health.ai.checked, false, 'the AI check is skipped when disabled');
});

test('readiness fails on a real ping failure, not just on readyState', async () => {
  stubConnection({ readyState: 1, ping: async () => { throw new Error('connection reset'); } });
  const health = await loadHealth().collectHealth();

  assert.equal(health.ready, false);
  assert.equal(health.status, 'degraded');
  assert.equal(health.database.status, 'disconnected');
  assert.match(health.database.detail, /connection reset/);
});

test('readiness fails when the uploads volume is not writable', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  // A regular file where the uploads directory should be: mkdirSync fails with
  // ENOTDIR immediately and deterministically (unlike paths under /proc, which
  // can block in sandboxes).
  const blocker = path.join(uploadsDir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  const health = await loadHealth({ UPLOADS_DIR: path.join(blocker, 'images') }).collectHealth();

  assert.equal(health.ready, false);
  assert.equal(health.uploads.writable, false);
  fs.rmSync(blocker, { force: true });
});

test('an unreachable AI service is reported but not fatal by default', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  const health = await loadHealth({
    AI_FEATURES_DISABLED: '',
    AI_SERVICE_URL: 'http://127.0.0.1:1',
    AI_HEALTH_TIMEOUT_MS: '500'
  }).collectHealth();

  assert.equal(health.ready, true, 'transcription is a feature, not a core dependency');
  assert.equal(health.ai.checked, true);
  assert.equal(health.ai.reachable, false);
  assert.equal(health.ai.fatal, false);

  const strict = await loadHealth({
    AI_FEATURES_DISABLED: '',
    AI_SERVICE_URL: 'http://127.0.0.1:1',
    AI_HEALTH_TIMEOUT_MS: '500',
    REQUIRE_AI_FOR_READY: 'true'
  }).collectHealth();
  assert.equal(strict.ready, false);
  assert.equal(strict.ai.fatal, true);
});

test('the public readiness payload keeps the shape but hides internals', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  const { collectHealth, publicHealth } = loadHealth();

  const full = await collectHealth();
  const exposed = publicHealth(full);

  assert.equal(exposed.ready, true);
  assert.equal(exposed.status, 'ok');
  assert.equal(exposed.database.status, 'connected');
  assert.equal(exposed.uploads.writable, true);
  assert.equal(exposed.ai.checked, false);
  assert.equal(exposed.database.detail, undefined, 'driver error text is internal');
  assert.equal(exposed.uploads.detail, undefined, 'the absolute uploads path is internal');
  assert.equal(exposed.ai.detail, undefined, 'the AI endpoint is internal');
  assert.equal(JSON.stringify(exposed).includes(uploadsDir), false, 'no server path may leak');
});

test('readiness details are opt-in outside development', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.match(server, /const healthDetailsEnabled = process\.env\.HEALTH_DETAILS/);
  assert.match(server, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(server, /const \{ collectHealth, publicHealth \} = require\('\.\/services\/healthService'\);/);

  const envExample = fs.readFileSync(path.join(__dirname, '../..', '.env.example'), 'utf8');
  assert.match(envExample, /HEALTH_DETAILS/, 'the opt-in must be documented for operators');
});

test('the readiness probes are cached so anonymous callers cannot amplify I/O', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  const health = loadHealth({
    AI_FEATURES_DISABLED: '',
    AI_SERVICE_URL: 'http://127.0.0.1:1',
    AI_HEALTH_TIMEOUT_MS: '200',
    HEALTH_PROBE_TTL_MS: '60000'
  });

  let writes = 0;
  let fetches = 0;
  const originalWrite = fs.writeFileSync;
  const originalFetch = globalThis.fetch;
  fs.writeFileSync = (...args) => { writes += 1; return originalWrite(...args); };
  globalThis.fetch = (...args) => { fetches += 1; return originalFetch(...args); };
  try {
    await health.collectHealth();
    await health.collectHealth();
    await health.collectHealth();
  } finally {
    fs.writeFileSync = originalWrite;
    globalThis.fetch = originalFetch;
  }

  assert.equal(writes, 1, 'the upload write probe must run once per TTL window');
  assert.equal(fetches, 1, 'the AI probe must run once per TTL window');

  health.resetHealthCaches();
  const originalWrite2 = fs.writeFileSync;
  let writesAfterReset = 0;
  fs.writeFileSync = (...args) => { writesAfterReset += 1; return originalWrite2(...args); };
  try {
    await health.collectHealth();
  } finally {
    fs.writeFileSync = originalWrite2;
  }
  assert.equal(writesAfterReset, 1, 'resetting the cache forces a fresh probe');
});

test('the server exposes live and ready endpoints next to the legacy one', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert.match(server, /app\.get\('\/api\/health', async \(req, res\) => \{/);
  assert.match(server, /app\.get\('\/api\/health\/live'/);
  assert.match(server, /app\.get\('\/api\/health\/ready'/);
  // v1.15.0: Alle drei Health-Routen melden die APP_VERSION (aus der vom Build
  // geschriebenen /app/server/VERSION) — der Betreiber soll sehen koennen,
  // welches Image tatsaechlich laeuft.
  assert.match(server, /const body = healthDetailsEnabled \? health : publicHealth\(health\);/);
  assert.match(server, /res\.status\(health\.ready \? 200 : 503\)\.json\(\{ version: APP_VERSION, \.\.\.body \}\);/);
  assert.match(server, /version: APP_VERSION, uptime: process\.uptime\(\)/);
  assert.match(server, /status: health\.status,\n\s+version: APP_VERSION,/);
  assert.match(server, /app\.use\(requestId\);/);

  // Review v1.15.0 (Versions-Kette): Die Routen melden APP_VERSION — gepinnt
  // ist auch, WOHER sie stammt. Dockerfile.allinone schreibt das Build-Arg in
  // /app/server/VERSION (s. deploymentSecurity-Tests); faellt dieses readFileSync
  // einer Refaktorierung zum Opfer, bleibt der stille 'dev'-Fallback, und der
  // Betreiber liest "dev" aus /api/health, während der Container längst 1.15.0
  // fährt — genau der Blindflug, den das Ops-Paket beenden sollte.
  assert.match(server,
    /const APP_VERSION = \(\(\) => \{\s*\n\s*try \{\s*\n\s*return fs\.readFileSync\(path\.join\(__dirname, 'VERSION'\), 'utf8'\)\.trim\(\) \|\| 'dev';\s*\n\s*\} catch/s,
    'APP_VERSION liest die vom Build geschriebene VERSION-Datei');

  for (const file of ['docker-compose.yml', 'docker-compose.npm.yml', 'docker-compose.allinone.yml', 'docker-compose.demo.yml']) {
    const compose = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    assert.match(compose, /api\/health\/ready/, `${file} should probe the readiness endpoint`);
  }
});

// ---------------------------------------------------------------------------
// Request ids and logging
// ---------------------------------------------------------------------------

test('the request id middleware generates, reuses and sanitises ids', () => {
  const requestId = require('../middleware/requestId');

  const run = (headers = {}) => {
    const req = { headers };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
    let called = false;
    requestId(req, res, () => { called = true; });
    assert.equal(called, true);
    return { id: req.id, header: res.headers['X-Request-Id'] };
  };

  const generated = run();
  assert.match(generated.id, /^[a-f0-9]{16}$/);
  assert.equal(generated.header, generated.id);

  const reused = run({ 'x-request-id': 'proxy-id-42' });
  assert.equal(reused.id, 'proxy-id-42');

  const oversized = run({ 'x-request-id': 'x'.repeat(200) });
  assert.match(oversized.id, /^[a-f0-9]{16}$/, 'an oversized id must be replaced');

  const injected = run({ 'x-request-id': 'a\nb"evil' });
  assert.match(injected.id, /^[a-f0-9]{16}$/, 'control characters must not be echoed');
});

test('the logger redacts secrets and supports JSON output', () => {
  const loggerPath = require.resolve('../utils/logger');
  delete require.cache[loggerPath];
  process.env.LOG_FORMAT = 'json';
  process.env.LOG_LEVEL = 'debug';
  const logger = require(loggerPath);

  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    logger.info('login attempt', {
      requestId: 'abc',
      headers: { cookie: 'kl_session=secret', 'x-csrf-token': 'token' },
      body: { email: 'a@b.c', password: 'hunter2' },
      error: Object.assign(new Error('boom'), { statusCode: 500 })
    });
  } finally {
    process.stdout.write = original;
  }

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'login attempt');
  assert.equal(entry.requestId, 'abc');
  assert.equal(entry.headers.cookie, '[redacted]');
  assert.equal(entry.headers['x-csrf-token'], '[redacted]');
  assert.equal(entry.body.password, '[redacted]');
  assert.equal(entry.body.email, 'a@b.c', 'non-secret fields stay readable');
  assert.equal(entry.error.message, 'boom');
  assert.equal(entry.error.stack, undefined, 'errors are flattened, no stack dump by default');

  delete process.env.LOG_FORMAT;
  delete process.env.LOG_LEVEL;
  delete require.cache[loggerPath];
});

test('the logger filters by level and writes human lines by default', () => {
  const loggerPath = require.resolve('../utils/logger');
  delete require.cache[loggerPath];
  process.env.LOG_LEVEL = 'warn';
  const logger = require(loggerPath);

  const out = [];
  const err = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  try {
    logger.info('ignored');
    logger.warn('careful', { requestId: 'r1' });
    logger.error('broken');
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }

  assert.deepEqual(out, [], 'info is below the configured level');
  assert.equal(err.length, 2);
  assert.match(err[0], /^WARN careful requestId=r1$/m);
  assert.match(err[1], /^ERROR broken$/m);

  delete process.env.LOG_LEVEL;
  delete require.cache[loggerPath];
});

test('error responses carry the request id for support', () => {
  const errorHandlerPath = require.resolve('../middleware/errorHandler');
  delete require.cache[errorHandlerPath];
  const errorHandler = require(errorHandlerPath);

  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };

  errorHandler(Object.assign(new Error('kaputt'), { statusCode: 404 }), { id: 'req-1', originalUrl: '/api/notes', method: 'GET' }, res, () => {});
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.requestId, 'req-1');

  const original = process.stderr.write;
  process.stderr.write = () => true;
  try {
    errorHandler(Object.assign(new Error('boom'), { statusCode: 500 }), { id: 'req-2', originalUrl: '/api/v1/notes', method: 'GET' }, res, () => {});
  } finally {
    process.stderr.write = original;
  }
  assert.equal(res.body.success, false, 'v1 keeps its envelope');
  assert.equal(res.body.requestId, 'req-2');
  delete require.cache[errorHandlerPath];
});

test('the AI service call forwards the request id', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/aiService.js'), 'utf8');
  assert.match(source, /async function transcribeAudio\(filePath, language = null, requestId = null\)/);
  assert.match(source, /'X-Request-Id': requestId/);

  const python = fs.readFileSync(path.join(__dirname, '../../ai/app.py'), 'utf8');
  assert.match(python, /request\.headers\.get\('X-Request-Id'/);
  assert.match(python, /request_id=%s/);
});

// v1.13.0 Nr. 4 — Freiplatz-Wächter: Health und Admin blieben grün, bis Uploads
// mit ENOSPC sterben (All-in-One: mongod und Uploads teilen eine Disk).
test('disk space is probed per volume and degrades status below the threshold', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  // Schwelle jenseits jeder realen Platte: `low` wird deterministisch true.
  const health = loadHealth({ HEALTH_MIN_FREE_MB: '99999999' });
  const result = await health.collectHealth();

  assert.equal(result.storage.uploads.low, true, 'uploads volume is below the absurd threshold');
  assert.ok(result.storage.uploads.freeBytes > 0);
  assert.ok(result.storage.uploads.totalBytes > 0);
  assert.equal(result.status, 'degraded', 'low disk degrades the status');
  assert.equal(result.ready, true, 'low disk is not fatal by default — reads still work');

  const exposed = health.publicHealth(result);
  assert.equal(exposed.storage.uploads.low, true, 'the low flag is public');
  assert.equal(exposed.storage.uploads.freeBytes, undefined, 'byte counts stay internal');
  assert.equal(exposed.storage.uploads.path, undefined, 'volume paths stay internal');
});

test('HEALTH_DISK_FATAL=true makes low disk space fatal for readiness', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  const health = loadHealth({ HEALTH_MIN_FREE_MB: '99999999', HEALTH_DISK_FATAL: 'true' });
  const result = await health.collectHealth();

  assert.equal(result.ready, false);
  assert.equal(result.status, 'degraded');

  const healthy = loadHealth({ HEALTH_MIN_FREE_MB: '1', HEALTH_DISK_FATAL: 'true' });
  const fine = await healthy.collectHealth();
  assert.equal(fine.storage.uploads.low, false);
  assert.equal(fine.ready, true);
  assert.equal(fine.status, 'ok');
});

test('a missing backup directory is reported without flipping low', async () => {
  stubConnection({ ping: async () => ({ ok: 1 }) });
  const health = loadHealth({ BACKUP_DIR: path.join(uploadsDir, 'does-not-exist') });
  const result = await health.collectHealth();

  assert.equal(result.storage.backups.ok, false, 'statfs on a missing dir fails');
  assert.equal(result.storage.backups.low, false, 'a config problem is not a disk-space problem');
  assert.equal(result.ready, true, 'and it must not affect readiness');
});

test('temporary upload probe files are cleaned up', () => {
  const leftovers = fs.readdirSync(uploadsDir).filter(name => name.startsWith('.health-'));
  assert.deepEqual(leftovers, []);
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});
