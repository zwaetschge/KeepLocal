/**
 * Eine Quelle für alle Pfade auf der Platte.
 *
 * Warum dieses Modul existiert (Audit 2026-09-12, Top-30 Nr. 6): `UPLOADS_DIR`
 * ist in README, docs/docker.md und den Compose-Mounts als **Wurzel** definiert
 * (sie enthält `images/` und `temp/`), aber nur `scripts/backup.js` hat sie so
 * gelesen. `middleware/upload.js`, `middleware/secureFileServe.js`,
 * `services/notesService.js` und `routes/notes.js` hatten `<server>/uploads`
 * hartkodiert, und `services/healthService.js` las dieselbe Variable als
 * **Bildverzeichnis**. Wer also der Doku folgte und die Uploads umzog, bekam:
 *   - `/api/health/ready` grün (der Schreibtest lief in einem Verzeichnis, in
 *     das die App nie schreibt — healthService legt es sogar selbst an),
 *   - „Backup geschrieben" mit `uploads.files = 0` (backup.js fand das alte,
 *     nun leere Verzeichnis nicht und hat das still akzeptiert),
 *   - und einen Restore, der die Datenbank zurückholt, aber kein einziges Bild.
 *
 * Semantik jetzt überall gleich: `UPLOADS_DIR` ist die Wurzel, `imagesDir()` und
 * `tempDir()` liegen darunter. Aufloesung pro Aufruf, damit Skripte und Tests
 * die Umgebung zwischen Laeufen umstellen koennen.
 */
const fs = require('node:fs');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');

const resolveOr = (value, fallback) => (value ? path.resolve(value) : fallback);

/** Wurzel des Upload-Volumes (enthält `images/` und `temp/`). */
function uploadsRoot() {
  return resolveOr(process.env.UPLOADS_DIR, path.join(SERVER_ROOT, 'uploads'));
}

/** Finale, validierte Nutzerdateien. */
function imagesDir() {
  return path.join(uploadsRoot(), 'images');
}

/** Eingang für laufende Uploads (vor der Validierung). */
function tempDir() {
  return path.join(uploadsRoot(), 'temp');
}

/** Recovery Points von scripts/backup.js. */
function backupRoot() {
  return resolveOr(process.env.BACKUP_DIR, path.join(SERVER_ROOT, 'backups'));
}

/** Legt beide Upload-Verzeichnisse an und liefert die aufgelösten Pfade. */
function ensureUploadDirs() {
  const images = imagesDir();
  const temp = tempDir();
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  return { root: uploadsRoot(), images, temp };
}

module.exports = { SERVER_ROOT, uploadsRoot, imagesDir, tempDir, backupRoot, ensureUploadDirs };
