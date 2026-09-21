/**
 * Backup-Scheduler — das Cron, das niemand einrichtet (v1.13.0).
 *
 * scripts/backup.js war reines CLI, das Timing delegierte die Doku an
 * „uebliches Host-Tooling“. Auf Unraid richtet das im Alltag niemand ein,
 * und ein stillstehender Backup-Job faellt erst beim Restore auf. Dieser
 * Scheduler laeuft im Serverprozess nach dem Muster des Storage-Janitors:
 * erster Lauf nach INITIAL_DELAY_MS, danach alle INTERVAL_HOURS, Timer
 * unref'd. Er nutzt die bestehende Mongoose-Connection und createBackup()
 * — inklusive dessen Vollstaendigkeits-Garantie (ein unvollstaendiges Backup
 * wird verworfen und wirft).
 *
 * Der Lauf-Status liegt als backup-status.json in der Backup-Wurzel (nicht in
 * der DB): Er ueberlebt damit auch einen DB-Restore und ist vom CLI lesbar.
 */
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');
const paths = require('../config/paths');
const backup = require('../scripts/backup');

// Gleiche Regel wie im Storage-Janitor: `${VAR:-}` durchgereichte leere
// Strings muessen den Default behalten, Number('') waere 0 (= aus).
const numberFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** 0 schaltet den Scheduler aus. Default 24h: Der Punkt der Verbesserung ist, dass ohne Cron ein Backup passiert. */
const INTERVAL_HOURS = numberFromEnv('BACKUP_INTERVAL_HOURS', 24);
const KEEP = numberFromEnv('BACKUP_KEEP', 7);
const INITIAL_DELAY_MS = numberFromEnv('BACKUP_INITIAL_DELAY_MS', 5 * 60 * 1000);

const STATUS_FILE = 'backup-status.json';

let running = null;

function statusPath() {
  return path.join(paths.backupRoot(), STATUS_FILE);
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(statusPath(), 'utf8'));
  } catch (_error) {
    return null; // noch kein Lauf (oder unlesbar) — kein Fehler-Zustand
  }
}

/** Atomic write: ein halb geschriebener Status ist schlimmer als keiner. */
function writeStatus(status) {
  const target = statusPath();
  fs.mkdirSync(paths.backupRoot(), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`);
  fs.renameSync(temp, target);
}

/**
 * Ein Backup-Lauf. Nicht doppelt starten (Timer + Admin-Button + CLI koennen
 * sich sonst gegenseitig die Retention wegschliessen). Gibt das Ergebnis
 * zurueck, wirft nicht — der naechste Lauf soll es erneut versuchen.
 */
async function runScheduledBackup({ keep = KEEP } = {}) {
  if (running) return running;
  running = (async () => {
    const startedAt = Date.now();
    try {
      const target = await backup.createBackup(keep);
      const status = {
        lastRunAt: new Date().toISOString(),
        ok: true,
        error: null,
        durationMs: Date.now() - startedAt,
        target: path.basename(target),
        intervalHours: INTERVAL_HOURS,
        keep
      };
      writeStatus(status);
      logger.info('scheduled backup finished', { target: status.target, durationMs: status.durationMs });
      return status;
    } catch (error) {
      const status = {
        lastRunAt: new Date().toISOString(),
        ok: false,
        error: String(error.message || error),
        durationMs: Date.now() - startedAt,
        target: null,
        intervalHours: INTERVAL_HOURS,
        keep
      };
      writeStatus(status);
      logger.error('scheduled backup failed', { error: status.error });
      return status;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Verzeichnis-Namen + Manifest-Kopfzeilen — KEINE Verify (die liest jede Byte). */
function listBackupSummaries() {
  const root = paths.backupRoot();
  const names = backup.listBackups();
  const summaries = [];
  for (const name of names.slice(-20).reverse()) {
    const summary = { name };
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, name, 'manifest.json'), 'utf8'));
      summary.createdAt = manifest.createdAt;
      summary.collections = manifest.collections?.length || 0;
      summary.documents = Array.isArray(manifest.collections)
        ? manifest.collections.reduce((total, entry) => total + (entry.count || 0), 0)
        : null;
      summary.uploadFiles = manifest.uploads?.files ?? null;
      summary.uploadBytes = manifest.uploads?.bytes ?? null;
      summary.format = manifest.format || 1;
    } catch (_error) {
      summary.unreadable = true; // z. B. abgebrochener Lauf ohne Manifest
    }
    summaries.push(summary);
  }
  return summaries;
}

function startBackupScheduler() {
  if (INTERVAL_HOURS <= 0) {
    logger.info('backup scheduler disabled', { reason: 'BACKUP_INTERVAL_HOURS=0' });
    return null;
  }
  const timers = [];
  const first = setTimeout(() => {
    runScheduledBackup().catch(() => {});
  }, INITIAL_DELAY_MS);
  first.unref?.();
  timers.push(first);

  const recurring = setInterval(() => {
    runScheduledBackup().catch(() => {});
  }, INTERVAL_HOURS * 60 * 60 * 1000);
  recurring.unref?.();
  timers.push(recurring);

  logger.info('backup scheduler scheduled', { intervalHours: INTERVAL_HOURS, keep: KEEP });
  return timers;
}

module.exports = {
  runScheduledBackup,
  listBackupSummaries,
  readStatus,
  writeStatus,
  startBackupScheduler,
  INTERVAL_HOURS,
  KEEP
};
