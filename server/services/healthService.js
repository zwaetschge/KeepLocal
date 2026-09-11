const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

/**
 * Readiness checks that go beyond mongoose's cached connection state.
 *
 * `/api/health` used to report "ok" whenever readyState was 1, so the compose and
 * nginx health checks stayed green while the database had actually gone away, the
 * uploads volume was read-only, or the AI service was dead.
 */

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(__dirname, '../uploads/images');
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai:5000';
const AI_TIMEOUT_MS = Number(process.env.AI_HEALTH_TIMEOUT_MS || 2000);

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
function checkUploadsWritable() {
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const probe = path.join(UPLOADS_DIR, `.health-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return { ok: true, detail: UPLOADS_DIR };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

/**
 * Optional AI check. It never decides readiness (transcription is a feature, not
 * a core dependency) — set REQUIRE_AI_FOR_READY=true to make it fatal.
 */
async function checkAiService() {
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

/**
 * @returns {Promise<{status: string, database: Object, uploads: Object, ai: Object, uptime: number, timestamp: string}>}
 */
async function collectHealth() {
  const [database, ai] = await Promise.all([pingDatabase(), checkAiService()]);
  const uploads = checkUploadsWritable();
  const aiFatal = process.env.REQUIRE_AI_FOR_READY === 'true';

  const ready = database.ok && uploads.ok && (!aiFatal || ai.ok);
  return {
    status: ready ? 'ok' : 'degraded',
    ready,
    database: { status: database.ok ? 'connected' : 'disconnected', detail: database.detail },
    uploads: { writable: uploads.ok, detail: uploads.detail },
    ai: { reachable: ai.ok, checked: Boolean(ai.checked), detail: ai.detail, fatal: aiFatal },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
}

module.exports = { collectHealth, pingDatabase, checkUploadsWritable, checkAiService, UPLOADS_DIR };
