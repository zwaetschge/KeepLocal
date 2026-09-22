const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// v1.13.0 Nr. 3 — Backup-Scheduler: backup.js war reines CLI, dessen Timing die
// Doku an Host-Cron delegierte. Der Scheduler laeuft im Serverprozess, schreibt
// den Lauf-Status als JSON in die Backup-Wurzel und doppelt sich nie selbst.

const schedulerPath = require.resolve('../services/backupScheduler');
const backupScriptPath = require.resolve('../scripts/backup');
const loggerPath = require.resolve('../utils/logger');

function loadScheduler(backupMock, env = {}) {
  delete require.cache[schedulerPath];
  require.cache[backupScriptPath] = { id: backupScriptPath, filename: backupScriptPath, loaded: true, exports: backupMock };
  require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { info() {}, warn() {}, error() {} } };
  const backupRoot = env.BACKUP_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-scheduler-'));
  process.env.BACKUP_DIR = backupRoot;
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return { scheduler: require(schedulerPath), backupRoot };
}

test('a scheduled run records ok status with target and interval', async () => {
  const calls = [];
  const { scheduler, backupRoot } = loadScheduler({
    createBackup: async (keep) => { calls.push(keep); return '/somewhere/keeplocal-20260921-120000-abc'; },
    listBackups: () => []
  });

  const status = await scheduler.runScheduledBackup();
  assert.deepEqual(calls, [7], 'default retention is passed through');
  assert.equal(status.ok, true);
  assert.equal(status.target, 'keeplocal-20260921-120000-abc');
  assert.equal(status.error, null);

  const onDisk = JSON.parse(fs.readFileSync(path.join(backupRoot, 'backup-status.json'), 'utf8'));
  assert.equal(onDisk.ok, true);
  assert.equal(onDisk.target, status.target);
  assert.ok(onDisk.lastRunAt);
  fs.rmSync(backupRoot, { recursive: true, force: true });
});

test('a failed run records the error and does not throw', async () => {
  const { scheduler, backupRoot } = loadScheduler({
    createBackup: async () => { throw new Error('Backup unvollständig: 3 referenzierte Dateien fehlen'); },
    listBackups: () => []
  });

  const status = await scheduler.runScheduledBackup();
  assert.equal(status.ok, false);
  assert.match(status.error, /unvollständig/);

  const onDisk = JSON.parse(fs.readFileSync(path.join(backupRoot, 'backup-status.json'), 'utf8'));
  assert.equal(onDisk.ok, false);
  assert.match(onDisk.error, /unvollständig/);
  fs.rmSync(backupRoot, { recursive: true, force: true });
});

test('concurrent triggers share one run instead of stacking backups', async () => {
  let running = 0;
  let peak = 0;
  const { scheduler, backupRoot } = loadScheduler({
    createBackup: async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 25));
      running -= 1;
      return '/x/keeplocal-one';
    },
    listBackups: () => []
  });

  const [a, b] = await Promise.all([scheduler.runScheduledBackup(), scheduler.runScheduledBackup()]);
  assert.equal(peak, 1, 'the second call awaits the in-flight run');
  assert.equal(a.target, b.target);
  fs.rmSync(backupRoot, { recursive: true, force: true });
});

test('backup summaries come from the manifests, newest first, without byte-verify', () => {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-scheduler-'));
  for (const [name, manifest] of [
    ['keeplocal-20260920-1-aaa', { createdAt: '2026-09-20T10:00:00Z', format: 2, collections: [{ name: 'notes', count: 600 }, { name: 'users', count: 3 }], uploads: { files: 50, bytes: 12345 } }],
    ['keeplocal-20260921-2-bbb', { createdAt: '2026-09-21T10:00:00Z', format: 2, collections: [{ name: 'notes', count: 679 }], uploads: { files: 49, bytes: 999 } }],
    ['keeplocal-20260921-3-ccc', null] // abgebrochener Lauf ohne Manifest
  ]) {
    fs.mkdirSync(path.join(backupRoot, name));
    if (manifest) fs.writeFileSync(path.join(backupRoot, name, 'manifest.json'), JSON.stringify(manifest));
  }

  const { scheduler } = loadScheduler({
    createBackup: async () => '/x',
    listBackups: () => ['keeplocal-20260920-1-aaa', 'keeplocal-20260921-2-bbb', 'keeplocal-20260921-3-ccc']
  }, { BACKUP_DIR: backupRoot });

  const summaries = scheduler.listBackupSummaries();
  assert.equal(summaries.length, 3);
  assert.equal(summaries[0].name, 'keeplocal-20260921-3-ccc');
  assert.equal(summaries[0].unreadable, true, 'a run without a manifest is flagged, not hidden');
  assert.equal(summaries[1].documents, 679);
  assert.equal(summaries[1].uploadFiles, 49);
  assert.equal(summaries[2].documents, 603);
  fs.rmSync(backupRoot, { recursive: true, force: true });
});

test('BACKUP_INTERVAL_HOURS=0 disables the scheduler and empty strings keep defaults', async () => {
  assert.equal(loadScheduler({ createBackup: async () => '/x', listBackups: () => [] }, { BACKUP_INTERVAL_HOURS: '0' }).scheduler.INTERVAL_HOURS, 0);
  assert.equal(loadScheduler({ createBackup: async () => '/x', listBackups: () => [] }, { BACKUP_INTERVAL_HOURS: '' }).scheduler.INTERVAL_HOURS, 24, 'compose-style ${VAR:-} must not read as 0');
  assert.equal(loadScheduler({ createBackup: async () => '/x', listBackups: () => [] }, { BACKUP_KEEP: '' }).scheduler.KEEP, 7);
});

test('the scheduler is wired into the server startup next to the janitor', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /const \{ startBackupScheduler \} = require\('\.\/services\/backupScheduler'\);/);
  assert.match(server, /startBackupScheduler\(\);/);

  const routes = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  assert.match(routes, /router\.get\('\/backups'/);
  assert.match(routes, /router\.post\('\/backups\/run'/);
  const envExample = fs.readFileSync(path.join(__dirname, '../..', '.env.example'), 'utf8');
  assert.match(envExample, /BACKUP_INTERVAL_HOURS/);
});
