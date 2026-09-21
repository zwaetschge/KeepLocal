const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { imagesDir, uploadsRoot, backupRoot } = require('../config/paths');

/**
 * Readiness checks that go beyond mongoose's cached connection state.
 *
 * `/api/health` used to report "ok" whenever readyState was 1, so the compose and
 * nginx health checks stayed green while the database had actually gone away, the
 * uploads volume was read-only, or the AI service was dead.
 */

// Geprobt wird das Verzeichnis, in das die App wirklich schreibt
// (config/paths: UPLOADS_DIR ist die Wurzel, Bilder liegen in images/). Vorher
// las dieser Check UPLOADS_DIR als Bildverzeichnis und meldete „writable" fuer
// einen Pfad, den kein Upload je benutzt.
const UPLOADS_DIR = imagesDir();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai:5000';
// `|| Default` statt `Number(x)`: Compose reicht Variablen als `${VAR:-}`
// durch, und `Number('')` ist 0 — ein AI-Timeout von 0 ms wuerde jede Probe
// sofort abbrechen und die Readiness grundlos auf `ai unreachable` ziehen.
const AI_TIMEOUT_MS = Number(process.env.AI_HEALTH_TIMEOUT_MS || 2000);
// Readiness wird von Docker-/Compose-Healthchecks (30 s), Load Balancern und
// anonymen Neugierigen aufgerufen. Ohne Cache macht jeder Aufruf einen
// synchronen Schreibtest plus einen ausgehenden Fetch zum AI-Dienst - ein
// Aufrufer ohne Auth könnte daraus kostenlose I/O-Verstärkung machen.
const PROBE_TTL_MS = Number(process.env.HEALTH_PROBE_TTL_MS || 30000); // '' -> Default, nicht 0
// Im All-in-One-Image teilen sich mongod (/data/db) und die Uploads denselben
// Wirtsdatenträger — der Janitor-Kommentar sagt es selbst: „ein voller
// Datenträger legt gleich die ganze Instanz lahm". Trotzdem prüfte bisher
// niemand den freien Platz: Health und Admin blieben grün, bis Uploads mit
// ENOSPC sterben. Unterhalb der Schwelle wird der Status „degraded" (nicht
// not-ready — Lesen funktioniert noch); HEALTH_DISK_FATAL=true macht es fatal.
const HEALTH_MIN_FREE_MB = Number(process.env.HEALTH_MIN_FREE_MB || 500);
const DISK_FATAL = process.env.HEALTH_DISK_FATAL === 'true';

const uploadsProbeCache = { at: 0, value: null };
const aiProbeCache = { at: 0, value: null };
const diskProbeCache = { at: 0, value: null };

/** Cache leeren (Tests, erzwungene Neu-Probe). */
function resetHealthCaches() {
  uploadsProbeCache.at = 0;
  uploadsProbeCache.value = null;
  aiProbeCache.at = 0;
  aiProbeCache.value = null;
  diskProbeCache.at = 0;
  diskProbeCache.value = null;
}

/** Real round trip instead of trusting the driver's cached state. */
async function pingDatabase() {
  if (mongoose.connection.readyState !== 1) {
    return { ok: false, detail: 'not connected' };
  }
  try {
    await mongoose.connection.db.admin().ping();
    return { ok: true, detail: 'connected' };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

/** The upload volume must be writable, otherwise every image upload 500s. */
function probeUploadsWritable() {
  const probeDir = imagesDir();
  try {
    fs.mkdirSync(probeDir, { recursive: true });
    const probe = path.join(probeDir, `.health-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return { ok: true, detail: probeDir };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

/**
 * Optional AI check. It never decides readiness (transcription is a feature, not
 * a core dependency) — set REQUIRE_AI_FOR_READY=true to make it fatal.
 */
async function probeAiService() {
  if (process.env.AI_FEATURES_DISABLED === 'true') {
    return { ok: true, detail: 'disabled', checked: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${AI_SERVICE_URL}/health`, { signal: controller.signal });
    return { ok: response.ok, detail: response.ok ? 'ok' : `HTTP ${response.status}`, checked: true };
  } catch (error) {
    return { ok: false, detail: error.name === 'AbortError' ? 'timeout' : error.message, checked: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Cached write probe; see PROBE_TTL_MS. */
function checkUploadsWritable() {
  const now = Date.now();
  if (uploadsProbeCache.value && now - uploadsProbeCache.at < PROBE_TTL_MS) {
    return uploadsProbeCache.value;
  }
  uploadsProbeCache.value = probeUploadsWritable();
  uploadsProbeCache.at = now;
  return uploadsProbeCache.value;
}

/** Cached AI probe; see PROBE_TTL_MS. */
async function checkAiService() {
  const now = Date.now();
  if (aiProbeCache.value && now - aiProbeCache.at < PROBE_TTL_MS) {
    return aiProbeCache.value;
  }
  aiProbeCache.value = await probeAiService();
  aiProbeCache.at = now;
  return aiProbeCache.value;
}

/** Ein Volume: freier/gesamter Platz via statfs (Node >= 18.15), low = unter Schwelle. */
function probeVolume(root, minFreeBytes) {
  try {
    const stats = fs.statfsSync(root);
    return {
      ok: true,
      path: root,
      freeBytes: stats.bavail * stats.bsize,
      totalBytes: stats.blocks * stats.bsize,
      low: stats.bavail * stats.bsize < minFreeBytes
    };
  } catch (error) {
    // Ein fehlendes Backup-Verzeichnis ist keine Disk-Frage — ok:false meldet
    // es, ohne `low` zu setzen (und ohne die Readiness zu kippen).
    return { ok: false, path: root, error: error.message, low: false };
  }
}

/** Freier Platz auf allen Volumes, auf die die App schreibt. */
function probeDiskSpace() {
  const minFreeBytes = HEALTH_MIN_FREE_MB * 1024 * 1024;
  return {
    uploads: probeVolume(uploadsRoot(), minFreeBytes),
    backups: probeVolume(backupRoot(), minFreeBytes)
  };
}

/** Cached disk probe; see PROBE_TTL_MS. */
function checkDiskSpace() {
  const now = Date.now();
  if (diskProbeCache.value && now - diskProbeCache.at < PROBE_TTL_MS) {
    return diskProbeCache.value;
  }
  diskProbeCache.value = probeDiskSpace();
  diskProbeCache.at = now;
  return diskProbeCache.value;
}

/**
 * @returns {Promise<{status: string, database: Object, uploads: Object, ai: Object, uptime: number, timestamp: string}>}
 */
async function collectHealth() {
  const [database, ai] = await Promise.all([pingDatabase(), checkAiService()]);
  const uploads = checkUploadsWritable();
  const storage = checkDiskSpace();
  const aiFatal = process.env.REQUIRE_AI_FOR_READY === 'true';
  const storageLow = Object.values(storage).some((volume) => volume.low);

  const ready = database.ok && uploads.ok && (!aiFatal || ai.ok) && (!DISK_FATAL || !storageLow);
  return {
    status: ready && !storageLow ? 'ok' : 'degraded',
    ready,
    database: { status: database.ok ? 'connected' : 'disconnected', detail: database.detail },
    uploads: { writable: uploads.ok, detail: uploads.detail },
    storage,
    ai: { reachable: ai.ok, checked: Boolean(ai.checked), detail: ai.detail, fatal: aiFatal },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
}

/**
 * Public readiness payload: same shape and same status code, but without the
 * internals. `uploads.detail` is an absolute server path, `database.detail` is a
 * verbatim driver error and `ai.detail` names the internal AI endpoint — all of
 * them useful for the operator, all of them free information for an anonymous
 * caller. Operators get the full object with HEALTH_DETAILS=true.
 */
function publicHealth(health) {
  const storage = {};
  for (const [key, volume] of Object.entries(health.storage || {})) {
    // Freie/gesamte Bytes verraten Partitionierungs- und Auslastungsdetails —
    // dieselbe Regel wie bei uploads.detail: Zahlen nur mit HEALTH_DETAILS.
    storage[key] = { ok: volume.ok, low: volume.low };
  }
  return {
    status: health.status,
    ready: health.ready,
    database: { status: health.database.status },
    uploads: { writable: health.uploads.writable },
    storage,
    ai: { reachable: health.ai.reachable, checked: health.ai.checked, fatal: health.ai.fatal },
    uptime: health.uptime,
    timestamp: health.timestamp
  };
}

module.exports = {
  collectHealth,
  publicHealth,
  pingDatabase,
  checkUploadsWritable,
  checkAiService,
  probeDiskSpace,
  checkDiskSpace,
  resetHealthCaches,
  PROBE_TTL_MS,
  UPLOADS_DIR
};
