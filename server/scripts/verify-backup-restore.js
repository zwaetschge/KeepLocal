/**
 * Backup/Restore einmal wirklich durchfahren — gegen eine echte MongoDB und ein
 * echtes Dateisystem, nicht gegen Quelltext-Regexe.
 *
 * Warum: `docs/docker.md` verspricht „test the restore before you need it",
 * VERBESSERUNGEN_2026-09-11 Punkt 10 wollte den Restore in CI gegen eine
 * Wegwerf-DB fahren, und der einzige Test war ein Source-Scan. Gleichzeitig war
 * der Backup-Pfad still kaputt, sobald UPLOADS_DIR gesetzt war: „Backup
 * geschrieben" mit null Dateien, grüner Readiness-Check, und ein Restore, der
 * die Datenbank zurückholte, aber kein einziges Bild.
 *
 * Geprüft wird:
 *   1. Backup erfasst Dokumente UND Bilder inkl. Prüfsummen
 *   2. --verify (CLI) ist grün, ein manipuliertes/fehlendes Upload nicht
 *   3. Ein Backup, dem ein referenziertes Bild fehlt, schlägt fehl und hinterlässt keinen Recovery Point
 *   4. Zerstören (DB droppen + Dateien löschen) und Restore: Dokumente mit
 *      ihren Typen (ObjectId/Date) und Dateien mit identischer Prüfsumme sind zurück
 *   5. UPLOADS_DIR wird von App-Pfaden und Backup gleich verstanden
 *
 * Usage:
 *   BACKUP_MONGODB_URI=mongodb://127.0.0.1:27017/keeplocal_backup \
 *     npm run verify:backup-restore
 *
 * Safety: droppt die Ziel-Datenbank und läuft nur gegen Namen, die nach Test
 * aussehen (backup/e2e/test/ci), sonst nur mit BACKUP_ALLOW_ANY_DB=1.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');

const SERVER_DIR = path.resolve(__dirname, '..');

function resolveUri() {
  const uri = process.env.BACKUP_MONGODB_URI || process.env.E2E_MONGODB_URI || process.env.MONGODB_URI
    || 'mongodb://127.0.0.1:27017/keeplocal_backup';
  const dbName = new URL(uri).pathname.replace(/^\//, '');
  if (!/(backup|e2e|test|ci)/i.test(dbName) && process.env.BACKUP_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `refusing to drop database "${dbName}": name does not look like a test database `
      + '(set BACKUP_ALLOW_ANY_DB=1 to override)'
    );
  }
  return { uri, dbName };
}

const failures = [];
function check(condition, message) {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${message}`);
  if (!condition) failures.push(message);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const { uri, dbName } = resolveUri();

  // Eigene Wegwerf-Verzeichnisse, damit weder echte Uploads noch echte Backups
  // angefasst werden. BACKUP_DIR wird im Skript beim require aufgelöst, also
  // vor dem Laden setzen.
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-uploads-'));
  const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-backups-'));
  process.env.UPLOADS_DIR = uploads;
  process.env.BACKUP_DIR = backups;

  const images = path.join(uploads, 'images');
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(path.join(uploads, 'temp'), { recursive: true });

  console.log(`[backup-restore] Ziel: ${dbName}`);
  console.log(`[backup-restore] UPLOADS_DIR=${uploads}`);
  console.log(`[backup-restore] BACKUP_DIR=${backups}`);

  const backupScript = require(path.join(SERVER_DIR, 'scripts/backup.js'));
  const paths = require(path.join(SERVER_DIR, 'config/paths.js'));
  check(paths.imagesDir() === images, 'config/paths resolves UPLOADS_DIR as the uploads root');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await mongoose.connection.dropDatabase();

    // --- Seed: ein Nutzer, eine Notiz mit Bild + Thumbnail -----------------
    const userId = new mongoose.Types.ObjectId();
    const noteId = new mongoose.Types.ObjectId();
    const created = new Date('2026-09-01T10:00:00.000Z');
    await mongoose.connection.db.collection('users').insertOne({
      _id: userId, username: 'backupuser', email: 'backup@example.com',
      password: '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      provider: 'local', isAdmin: true, createdAt: created, updatedAt: created
    });
    const original = path.join(images, 'seed.png');
    const thumb = path.join(images, 'seed-thumb.webp');
    fs.writeFileSync(original, 'PNG-ORIGINAL-CONTENT');
    fs.writeFileSync(thumb, 'WEBP-THUMB-CONTENT');
    const originalSha = sha256(original);
    const thumbSha = sha256(thumb);
    await mongoose.connection.db.collection('notes').insertOne({
      _id: noteId, userId, title: 'Backup-Notiz', content: 'Inhalt <mit> Sonderzeichen',
      tags: ['backup'], isPinned: false, isArchived: false, deletedAt: null,
      images: [{ filename: 'seed.png', thumbnailFilename: 'seed-thumb.webp', url: '/uploads/images/seed.png' }],
      createdAt: created, updatedAt: created
    });

    // --- 1) Backup anlegen -------------------------------------------------
    const target = await backupScript.createBackup(7);
    // Zwei Läufe in derselben Sekunde dürfen sich nicht dasselbe Verzeichnis
    // teilen (Sekunden-Timestamp) — sonst löscht ein fehlgeschlagener Lauf den
    // vorhandenen Recovery Point.
    const second = await backupScript.createBackup(7);
    check(second !== target, 'two backups in the same second get distinct directories');
    check(fs.readdirSync(backups).length === 2, 'both recovery points exist side by side');
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    check(manifest.format === 2, 'manifest uses format 2');
    check(manifest.uploads.files === 2, `both image files are captured (got ${manifest.uploads.files})`);
    check(manifest.uploads.referenced === 2, `the database reference count is recorded (${manifest.uploads.referenced})`);
    check(manifest.uploads.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)), 'every upload has a sha256');
    check(manifest.collections.some((entry) => entry.name === 'notes' && entry.count === 1), 'the notes collection is dumped');

    // --- 2) --verify: CLI grün, manipuliert/fehlend rot --------------------
    const cli = spawnSync(process.execPath, [path.join(SERVER_DIR, 'scripts/backup.js'), '--verify', target], {
      cwd: SERVER_DIR, encoding: 'utf8', env: process.env
    });
    check(cli.status === 0, `backup.js --verify exits 0 (status=${cli.status})`);
    check(/Recovery Point OK/.test(cli.stdout || ''), '--verify reports the recovery point as OK');

    const backupImage = path.join(target, 'uploads', 'images', 'seed.png');
    // Gleiche Länge, anderer Inhalt: die Größenprüfung bleibt grün, die
    // Prüfsumme muss anschlagen.
    fs.writeFileSync(backupImage, 'PNG-TAMPERED-CONTENT');
    let corrupted = null;
    try { backupScript.verifyBackup(target); } catch (error) { corrupted = error.message; }
    check(/Prüfsumme stimmt nicht/.test(corrupted || ''), `a tampered upload fails verification (got: ${corrupted})`);
    fs.writeFileSync(backupImage, 'PNG-ORIGINAL-CONTENT');

    const backupThumb = path.join(target, 'uploads', 'images', 'seed-thumb.webp');
    fs.rmSync(backupThumb);
    let missing = null;
    try { backupScript.verifyBackup(target); } catch (error) { missing = error.message; }
    check(/Upload-Datei fehlt/.test(missing || ''), 'a missing upload fails verification');
    fs.writeFileSync(backupThumb, 'WEBP-THUMB-CONTENT');
    check(backupScript.verifyBackup(target).uploads === 2, 'the untouched recovery point verifies again');

    // --- 3) Unvollständiges Backup darf nicht entstehen --------------------
    fs.rmSync(original);
    let incomplete = null;
    try {
      await backupScript.createBackup(7);
    } catch (error) {
      incomplete = error.message;
    }
    check(/Backup unvollständig/.test(incomplete || ''), 'a backup with a missing referenced image fails');
    check(fs.readdirSync(backups).length === 2, 'the incomplete backup left the existing recovery points untouched');
    check(fs.existsSync(path.join(target, 'manifest.json')), 'the good recovery point survived the failed run');
    fs.writeFileSync(original, 'PNG-ORIGINAL-CONTENT');

    // --- 4) Zerstören und wiederherstellen ---------------------------------
    await mongoose.connection.dropDatabase();
    fs.rmSync(original, { force: true });
    fs.rmSync(thumb, { force: true });
    check(await mongoose.connection.db.collection('notes').countDocuments() === 0, 'database is empty before the restore');
    check(!fs.existsSync(original) && !fs.existsSync(thumb), 'uploads are gone before the restore');

    await backupScript.restoreBackup(target);

    const note = await mongoose.connection.db.collection('notes').findOne({ _id: noteId });
    const user = await mongoose.connection.db.collection('users').findOne({ _id: userId });
    check(Boolean(note) && Boolean(user), 'documents are back');
    check(note?.title === 'Backup-Notiz' && note?.content === 'Inhalt <mit> Sonderzeichen', 'content survived verbatim');
    check(note?._id instanceof mongoose.Types.ObjectId || note?._id?._bsontype === 'ObjectId', 'ObjectId types survived');
    check(note?.createdAt instanceof Date && note.createdAt.toISOString() === created.toISOString(), 'Date types survived');
    check(Array.isArray(note?.images) && note.images[0].thumbnailFilename === 'seed-thumb.webp', 'image references survived');
    check(fs.existsSync(original) && sha256(original) === originalSha, 'the image file is back with an identical checksum');
    check(fs.existsSync(thumb) && sha256(thumb) === thumbSha, 'the thumbnail is back with an identical checksum');
  } finally {
    await mongoose.disconnect();
    fs.rmSync(uploads, { recursive: true, force: true });
    fs.rmSync(backups, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`[backup-restore] FEHLGESCHLAGEN (${failures.length}): ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[backup-restore] OK — Backup, Verify und Restore funktionieren gegen echte Daten');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[backup-restore] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main, resolveUri };
