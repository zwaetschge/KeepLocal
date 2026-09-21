/**
 * Storage janitor — räumt auf, was der Papierkorb verspricht.
 *
 * Warum: `models/Note.js` legt einen partiellen TTL-Index auf `deletedAt`.
 * MongoDB löscht darüber das **Dokument**, kennt aber die Bilddateien nicht —
 * jede per TTL verschwundene Notiz ließ bis zu 25 Originalbilder plus
 * Thumbnails für immer liegen. Im All-in-One-Image teilen sich mongod
 * (/data/db) und die Uploads (/app/server/uploads) denselben Wirtsdatenträger,
 * ein voller Datenträger legt also gleich die ganze Instanz lahm. Die UI
 * verspricht gleichzeitig „nach 30 Tagen löscht der Server sie endgültig".
 *
 * Drei konservative Regeln, ein Lauf = eine strukturierte Logzeile:
 *   (a) Notizen, die länger als die Retention im Papierkorb liegen: erst die
 *       Dateien, dann das Dokument (der TTL-Index bleibt als Backstop einen Tag
 *       länger stehen, damit dieser Pfad das Rennen gewinnt).
 *   (b) Dateien in uploads/images und uploads/files (v1.12.0, PDF-Anhänge),
 *       die älter als ORPHAN_MIN_AGE_HOURS sind und
 *       von **keiner** Notiz referenziert werden — gelöschte Notizen zählen als
 *       referenziert, sonst würde der Papierkorb seine Bilder verlieren.
 *   (c) uploads/temp älter als TEMP_MIN_AGE_MINUTES (abgebrochene Uploads).
 *
 * Alles ist idempotent und wird pro Schritt einzeln abgefangen: ein Fehler beim
 * Aufräumen darf niemals den Server mitreissen.
 */
const fs = require('node:fs');
const path = require('node:path');
const Note = require('../models/Note');
const logger = require('../utils/logger');
const paths = require('../config/paths');
const { deleteNoteImages, deleteNoteFiles } = require('./notesService');

// Leere Werte muessen den Default behalten: Compose-Dateien reichen Variablen
// als `${VAR:-}` durch, also als leerer String. `Number('')` ist 0 — bei
// TRASH_RETENTION_DAYS wuerde das den kompletten Papierkorb sofort endgueltig
// loeschen.
const numberFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Nutzerversprechen: 30 Tage Papierkorb. */
const TRASH_RETENTION_DAYS = numberFromEnv('TRASH_RETENTION_DAYS', 30);
/** Eine Datei muss so lange unreferenziert sein, bevor sie als Waise gilt. */
const ORPHAN_MIN_AGE_HOURS = numberFromEnv('STORAGE_ORPHAN_MIN_AGE_HOURS', 24);
/** Abgebrochene Uploads: ein Stunde Kulanz für laufende Requests. */
const TEMP_MIN_AGE_MINUTES = numberFromEnv('STORAGE_TEMP_MIN_AGE_MINUTES', 60);
/** 0 schaltet den Janitor aus (z. B. in Tests oder bei externem Cron). */
const INTERVAL_HOURS = numberFromEnv('STORAGE_JANITOR_INTERVAL_HOURS', 6);
const INITIAL_DELAY_MS = numberFromEnv('STORAGE_JANITOR_INITIAL_DELAY_MS', 60000);

const DAY_MS = 24 * 60 * 60 * 1000;

function listFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function statAge(filePath, now) {
  try {
    const stats = fs.statSync(filePath);
    return { ageMs: now - stats.mtimeMs, size: stats.size };
  } catch (_error) {
    return null; // concurrently removed
  }
}

/**
 * (a) Papierkorb endgültig leeren: erst Dateien, dann Dokumente.
 * Das Lösch-Prädikat wird beim deleteMany wiederholt, damit eine Notiz, die
 * zwischen Find und Delete wiederhergestellt wurde, nicht verschwindet.
 */
async function purgeExpiredTrash({ now = Date.now(), retentionDays = TRASH_RETENTION_DAYS } = {}) {
  const cutoff = new Date(now - retentionDays * DAY_MS);
  const predicate = { deletedAt: { $type: 'date', $lte: cutoff } };
  const expired = await Note.find(predicate).select('images files').lean();
  if (expired.length === 0) {
    return { notes: 0, files: 0 };
  }

  let files = 0;
  for (const note of expired) {
    for (const image of note.images || []) {
      files += image?.thumbnailFilename ? 2 : 1;
    }
    files += (note.files || []).length;
    await deleteNoteImages(note);
    await deleteNoteFiles(note);
  }
  const deleted = await Note.deleteMany({ _id: { $in: expired.map((note) => note._id) }, ...predicate });
  return { notes: deleted.deletedCount || 0, files };
}

/**
 * (b) Verwaiste Bilddateien entfernen. Referenziert = von irgendeiner Notiz
 * (auch einer gelöschten) als `images.filename` oder `thumbnailFilename` geführt.
 */
async function removeOrphanedImages({ now = Date.now(), minAgeHours = ORPHAN_MIN_AGE_HOURS, imagesDir = paths.imagesDir() } = {}) {
  const files = listFiles(imagesDir);
  if (files.length === 0) {
    return { files: 0, bytes: 0 };
  }

  const referenced = new Set();
  const notes = await Note.find({}).select('images.filename images.thumbnailFilename').lean();
  for (const note of notes) {
    for (const image of note.images || []) {
      if (image?.filename) referenced.add(image.filename);
      if (image?.thumbnailFilename) referenced.add(image.thumbnailFilename);
    }
  }

  let removed = 0;
  let bytes = 0;
  for (const name of files) {
    if (name === '.gitkeep' || referenced.has(name)) continue;
    const filePath = path.join(imagesDir, name);
    const stats = statAge(filePath, now);
    if (!stats || stats.ageMs < minAgeHours * 60 * 60 * 1000) continue;
    try {
      fs.unlinkSync(filePath);
      removed += 1;
      bytes += stats.size;
    } catch (error) {
      logger.warn('storage janitor could not remove an orphan', { file: name, error: error.message });
    }
  }
  return { files: removed, bytes };
}

/**
 * (b2) Verwaiste Dateianhänge entfernen. Referenziert = als `files.filename`
 * geführt — identische Regel wie bei Bildern, nur das andere Verzeichnis.
 */
async function removeOrphanedFiles({ now = Date.now(), minAgeHours = ORPHAN_MIN_AGE_HOURS, filesDir = paths.filesDir() } = {}) {
  const diskFiles = listFiles(filesDir);
  if (diskFiles.length === 0) {
    return { files: 0, bytes: 0 };
  }

  const referenced = new Set();
  const notes = await Note.find({}).select('files.filename').lean();
  for (const note of notes) {
    for (const file of note.files || []) {
      if (file?.filename) referenced.add(file.filename);
    }
  }

  let removed = 0;
  let bytes = 0;
  for (const name of diskFiles) {
    if (name === '.gitkeep' || referenced.has(name)) continue;
    const filePath = path.join(filesDir, name);
    const stats = statAge(filePath, now);
    if (!stats || stats.ageMs < minAgeHours * 60 * 60 * 1000) continue;
    try {
      fs.unlinkSync(filePath);
      removed += 1;
      bytes += stats.size;
    } catch (error) {
      logger.warn('storage janitor could not remove an orphaned attachment', { file: name, error: error.message });
    }
  }
  return { files: removed, bytes };
}

/** (c) uploads/temp leeren (abgebrochene oder gekillte Uploads). */
function cleanTempUploads({ now = Date.now(), minAgeMinutes = TEMP_MIN_AGE_MINUTES, tempDir = paths.tempDir() } = {}) {
  let removed = 0;
  let bytes = 0;
  for (const name of listFiles(tempDir)) {
    if (name === '.gitkeep') continue;
    const filePath = path.join(tempDir, name);
    const stats = statAge(filePath, now);
    if (!stats || stats.ageMs < minAgeMinutes * 60 * 1000) continue;
    try {
      fs.unlinkSync(filePath);
      removed += 1;
      bytes += stats.size;
    } catch (error) {
      logger.warn('storage janitor could not remove a temp upload', { file: name, error: error.message });
    }
  }
  return { files: removed, bytes };
}

/** Ein Lauf, eine Logzeile. Fehler pro Schritt, nie nach oben. */
async function runStorageJanitor(options = {}) {
  const started = Date.now();
  const result = {
    expiredTrash: { notes: 0, files: 0 },
    orphans: { files: 0, bytes: 0 },
    orphanFiles: { files: 0, bytes: 0 },
    temp: { files: 0, bytes: 0 },
    errors: []
  };

  for (const [key, task] of [
    ['expiredTrash', () => purgeExpiredTrash(options)],
    ['orphans', () => removeOrphanedImages(options)],
    ['orphanFiles', () => removeOrphanedFiles(options)],
    ['temp', () => Promise.resolve(cleanTempUploads(options))]
  ]) {
    try {
      result[key] = await task();
    } catch (error) {
      result.errors.push(`${key}: ${error.message}`);
      logger.error('storage janitor step failed', { step: key, error: error.message });
    }
  }

  logger.info('storage janitor run', {
    durationMs: Date.now() - started,
    expiredNotes: result.expiredTrash.notes,
    expiredFiles: result.expiredTrash.files,
    orphanedFiles: result.orphans.files,
    orphanedBytes: result.orphans.bytes,
    tempFiles: result.temp.files,
    errors: result.errors.length
  });
  return result;
}

/**
 * Startet den Janitor: erster Lauf nach INITIAL_DELAY_MS (der Start soll nicht
 * langsamer werden), danach alle INTERVAL_HOURS. Timer sind unref'd, damit sie
 * Skripte und Tests nicht offen halten.
 */
function startStorageJanitor(options = {}) {
  if (INTERVAL_HOURS <= 0) {
    logger.info('storage janitor disabled', { reason: 'STORAGE_JANITOR_INTERVAL_HOURS=0' });
    return null;
  }
  const initialDelay = Number.isFinite(options.initialDelayMs) ? options.initialDelayMs : INITIAL_DELAY_MS;
  const timers = [];
  const first = setTimeout(() => {
    runStorageJanitor().catch(() => {});
  }, initialDelay);
  first.unref?.();
  timers.push(first);

  const recurring = setInterval(() => {
    runStorageJanitor().catch(() => {});
  }, INTERVAL_HOURS * 60 * 60 * 1000);
  recurring.unref?.();
  timers.push(recurring);

  logger.info('storage janitor scheduled', { intervalHours: INTERVAL_HOURS, retentionDays: TRASH_RETENTION_DAYS });
  return timers;
}

module.exports = {
  purgeExpiredTrash,
  removeOrphanedImages,
  removeOrphanedFiles,
  cleanTempUploads,
  runStorageJanitor,
  startStorageJanitor,
  TRASH_RETENTION_DAYS,
  ORPHAN_MIN_AGE_HOURS,
  TEMP_MIN_AGE_MINUTES,
  imagesDir: paths.imagesDir,
  tempDir: paths.tempDir
};
