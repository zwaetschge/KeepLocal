const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 24): Das All-in-One-Image schrieb keine einzige
// Anwendungs-Logzeile nach `docker logs` — alle fünf supervisord-Programme
// loggten in Dateien unter /var/log/supervisor/, die im Container-Layer liegen
// und mit jedem Update (`--force-recreate`) sterben, also genau dann, wenn man
// sie braucht. Dazu war keine der dokumentierten Betriebs-Variablen
// (LOG_LEVEL/LOG_FORMAT, Budgets, Readiness-Gate, Janitor, BACKUP_DIR) in einem
// Deployment-Vertrag setzbar: Compose-`environment`-Listen und das
// Unraid-Template schnitten sie ab, Betreiber mussten die eingecheckte Datei
// editieren.

const root = path.resolve(__dirname, '../..');
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.npm.yml', 'docker-compose.allinone.yml', 'docker-compose.demo.yml'];
const OPS_VARS = [
  'LOG_LEVEL', 'LOG_FORMAT', 'REQUIRE_AI_FOR_READY', 'AI_HEALTH_TIMEOUT_MS',
  'LINK_PREVIEW_LIMIT_PER_MINUTE', 'TRANSCRIPTION_LIMIT_PER_HOUR',
  'TRANSCRIPTION_LIMIT_PER_DAY', 'TRANSCRIPTION_MINUTES_PER_DAY',
  'MAX_CONCURRENT_TRANSCRIPTIONS', 'TRASH_RETENTION_DAYS',
  'STORAGE_JANITOR_INTERVAL_HOURS',
  // v1.17.0: die Governance-Variablen aus v1.16.0 waren im Server lesbar,
  // aber in keinem Deployment-Vertrag setzbar — Quota, Backup-/Health-
  // Freiplatz-Schwellen und Disk-Fatal mussten eingecheckte Dateien editieren.
  'UPLOAD_QUOTA_MB', 'BACKUP_MIN_FREE_MB', 'HEALTH_MIN_FREE_MB', 'HEALTH_DISK_FATAL'
];

test('all-in-one program logs reach docker logs instead of the container layer', () => {
  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
  const programs = supervisor.match(/\[program:[a-z-]+\]/g) || [];
  assert.equal(programs.length, 5, 'mongodb, ai, demo-reset, nodejs, nginx');

  assert.equal((supervisor.match(/stdout_logfile=\/dev\/stdout/g) || []).length, 5);
  // 5 Programme + der Eventlistener: dessen stdout ist der Protokollkanal zu
  // supervisord (/dev/null), seine Fehler gehen aber ebenfalls nach docker logs.
  assert.equal((supervisor.match(/stderr_logfile=\/dev\/stderr/g) || []).length, 6);
  assert.match(supervisor, /\[eventlistener:fatal-exit\][\s\S]*?stdout_logfile=\/dev\/null/);
  assert.equal((supervisor.match(/stdout_logfile_maxbytes=0/g) || []).length, 5, 'rotation moves to the log driver');
  assert.doesNotMatch(supervisor, /stdout_logfile=\/var\/log\/supervisor/, 'no program may log into the layer');

  // nginx schreibt access/error selbst — dieselben Symlinks wie im offiziellen Image.
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  assert.match(dockerfile, /ln -sf \/dev\/stdout \/var\/log\/nginx\/access\.log/);
  assert.match(dockerfile, /ln -sf \/dev\/stderr \/var\/log\/nginx\/error\.log/);
});

test('every compose variant caps its container logs', () => {
  for (const file of COMPOSE_FILES) {
    const compose = fs.readFileSync(path.join(root, file), 'utf8');
    const services = (compose.match(/\n  [a-z][a-z-]*:\n/g) || []).length;
    const loggingBlocks = (compose.match(/\n    logging:\n/g) || []).length;
    assert.ok(loggingBlocks >= 1, `${file} must configure logging`);
    assert.match(compose, /driver: json-file/, `${file} must name the driver`);
    assert.match(compose, /max-size: "10m"/, `${file} must cap the log size`);
    assert.match(compose, /max-file: "3"/, `${file} must cap the number of files`);
    assert.ok(services > 0, `${file} must define services`);
  }
});

test('documented operational variables are settable in every deployment contract', () => {
  for (const file of COMPOSE_FILES) {
    const compose = fs.readFileSync(path.join(root, file), 'utf8');
    for (const variable of OPS_VARS) {
      assert.match(compose, new RegExp(`${variable}[=:]`, 'm'), `${file} must pass ${variable} through`);
    }
  }

  // Unraid: Template statt Compose-Datei.
  const template = fs.readFileSync(path.join(root, 'unraid-template.xml'), 'utf8');
  for (const variable of [...OPS_VARS, 'BACKUP_DIR', 'UPLOADS_DIR', 'AI_SERVICE_TOKEN', 'HEALTH_DETAILS']) {
    assert.match(template, new RegExp(`Target="${variable}"`), `the Unraid template must expose ${variable}`);
  }
  assert.match(template, /Target="\/app\/server\/backups"/, 'recovery points need a host path');
});

test('empty passthrough values keep the application defaults', () => {
  // Compose reicht nicht gesetzte Variablen als leeren String durch
  // (`${VAR:-}`). `Number('')` ist 0 — bei TRASH_RETENTION_DAYS würde das den
  // kompletten Papierkorb sofort endgültig löschen.
  const saved = { ...process.env };
  const janitorPath = require.resolve('../services/storageJanitor');
  const healthPath = require.resolve('../services/healthService');
  try {
    for (const key of ['TRASH_RETENTION_DAYS', 'STORAGE_JANITOR_INTERVAL_HOURS', 'STORAGE_ORPHAN_MIN_AGE_HOURS',
      'STORAGE_TEMP_MIN_AGE_MINUTES', 'AI_HEALTH_TIMEOUT_MS', 'HEALTH_PROBE_TTL_MS']) {
      process.env[key] = '';
    }
    process.env.AI_FEATURES_DISABLED = 'true';
    delete require.cache[janitorPath];
    delete require.cache[healthPath];
    const janitor = require(janitorPath);
    const health = require(healthPath);

    assert.equal(janitor.TRASH_RETENTION_DAYS, 30, 'an empty value must not mean "delete everything now"');
    assert.equal(janitor.ORPHAN_MIN_AGE_HOURS, 24);
    assert.equal(janitor.TEMP_MIN_AGE_MINUTES, 60);
    assert.equal(health.PROBE_TTL_MS, 30000, 'an empty value must not disable probe caching');
    assert.ok(janitor.startStorageJanitor({ initialDelayMs: 3600000 }), 'an empty interval must not disable the janitor');
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[janitorPath];
    delete require.cache[healthPath];
  }

  // Explizit gesetzte Werte gelten weiterhin.
  const janitorPath2 = require.resolve('../services/storageJanitor');
  process.env.TRASH_RETENTION_DAYS = '7';
  process.env.STORAGE_JANITOR_INTERVAL_HOURS = '0';
  delete require.cache[janitorPath2];
  const configured = require(janitorPath2);
  assert.equal(configured.TRASH_RETENTION_DAYS, 7);
  assert.equal(configured.startStorageJanitor(), null, '0 still switches the janitor off');
  delete process.env.TRASH_RETENTION_DAYS;
  delete process.env.STORAGE_JANITOR_INTERVAL_HOURS;
  delete require.cache[janitorPath2];
});

test('the docs say where the logs are', () => {
  const dockerDocs = fs.readFileSync(path.join(root, 'docs/docker.md'), 'utf8');
  assert.match(dockerDocs, /docker logs/, 'operators must be pointed at docker logs');
  assert.match(dockerDocs, /LOG_FORMAT|LOG_LEVEL/, 'the log variables must be documented');

  const unraidDocs = fs.readFileSync(path.join(root, 'docs/unraid.md'), 'utf8');
  assert.match(unraidDocs, /docker logs|Log-Ansicht|logs/, 'the Unraid guide must not send operators to a vanished file');
  assert.doesNotMatch(unraidDocs, /tail -n 100 \/var\/log\/supervisor/, 'that file no longer receives program logs');
});
