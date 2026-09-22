#!/usr/bin/env node
/**
 * KeepLocal backup and restore — dependency-free.
 *
 * The docs told users to run mongodump and copy the uploads directory by hand,
 * which works only where mongodump exists (not in the split server image) and
 * leaves the two halves unsynchronised. This script writes one directory
 * containing every collection as type-preserving NDJSON plus the uploads, with a
 * SHA-256 manifest, and can restore it.
 *
 * Usage:
 *   MONGODB_URI=... node scripts/backup.js                 # create a backup
 *   MONGODB_URI=... node scripts/backup.js --keep 5        # retention (default 7)
 *   MONGODB_URI=... node scripts/backup.js --list
 *   node scripts/backup.js --verify <dir>                  # check a recovery point (no DB needed)
 *   MONGODB_URI=... node scripts/backup.js --restore <dir> --force
 *
 * Environment:
 *   MONGODB_URI   (required for create/restore, not for --verify/--list)
 *   BACKUP_DIR    default <server>/backups — mount this, or the recovery point
 *                 dies with the container layer on the next update
 *   UPLOADS_DIR   default <server>/uploads — the ROOT that contains images/ and
 *                 temp/ (config/paths.js is the single source of truth, so the
 *                 app, the readiness probe and this script cannot disagree)
 *
 * Hard guarantees (audit 2026-09-12, Top-30 Nr. 6):
 *   - A backup is only "written" when every image referenced by the database was
 *     captured. A missing uploads directory used to produce a successful-looking
 *     backup with zero files.
 *   - Every upload file has a size and a SHA-256 in the manifest.
 *   - Restore verifies the WHOLE recovery point before the first destructive
 *     statement, inserts with `ordered: false` and compares the resulting
 *     document counts against the manifest.
 *
 * Restore is destructive and refuses to run without --force.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { backupRoot, uploadsRoot, imagesDir, filesDir } = require('../config/paths');

const BACKUP_DIR = backupRoot();
const DEFAULT_KEEP = 7;
const PREFIX = 'keeplocal-';
const MANIFEST_FORMAT = 2;
const INSERT_CHUNK = 500;

// ---------------------------------------------------------------------------
// Type-preserving JSON (ObjectId/Date/Buffer/Decimal128 survive the round trip)
// ---------------------------------------------------------------------------

function encode(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof mongoose.Types.ObjectId || value?._bsontype === 'ObjectID' || value?._bsontype === 'ObjectId') {
    return { $oid: value.toString() };
  }
  if (value?._bsontype === 'Decimal128') return { $numberDecimal: value.toString() };
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item);
    return out;
  }
  return value;
}

function decode(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      if (keys[0] === '$date') return new Date(value.$date);
      if (keys[0] === '$oid') return new mongoose.Types.ObjectId(value.$oid);
      if (keys[0] === '$numberDecimal') return mongoose.Types.Decimal128.fromString(value.$numberDecimal);
      if (keys[0] === '$binary') return Buffer.from(value.$binary, 'base64');
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decode(item);
    return out;
  }
  return value;
}

// Streaming-Hash statt readFileSync (v1.14.0): Der Backup-Scheduler läuft seit
// v1.13.0 im Serverprozess — der alte Hash lud jede Datei komplett in den
// Speicher und blockierte dabei den Event-Loop; bei hunderten MB Uploads
// answered der Server während des gesamten Backups keine Requests mehr.
const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  fs.createReadStream(file)
    .on('error', reject)
    .on('data', chunk => hash.update(chunk))
    .on('end', () => resolve(hash.digest('hex')));
});

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Which upload files does the database expect to exist (images + attachments)? */
async function referencedImageFilenames() {
  const referenced = new Set();
  const exists = await mongoose.connection.db.listCollections({ name: 'notes' }).hasNext();
  if (!exists) return referenced;
  const cursor = mongoose.connection.db.collection('notes').find({}, { projection: { images: 1, files: 1 } });
  for await (const doc of cursor) {
    for (const image of doc.images || []) {
      if (image?.filename) referenced.add(image.filename);
      if (image?.thumbnailFilename) referenced.add(image.thumbnailFilename);
    }
    for (const file of doc.files || []) {
      if (file?.filename) referenced.add(file.filename);
    }
  }
  return referenced;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

async function createBackup(keep) {
  // mkdtemp statt fester Name: `timestamp()` hat Sekunden-Auflösung, zwei Läufe
  // in derselben Sekunde (oder ein fehlgeschlagener Lauf direkt nach einem
  // erfolgreichen) würden sonst dasselbe Verzeichnis treffen — und ein
  // unvollständiges Backup hätte mit `rmSync(target)` den vorhandenen Recovery
  // Point gelöscht. Genau das ist in CI passiert.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = fs.mkdtempSync(path.join(BACKUP_DIR, `${PREFIX}${timestamp()}-`));
  try {
    const dbDir = path.join(target, 'db');
    const uploadsTarget = path.join(target, 'uploads');
    const images = imagesDir();
    fs.mkdirSync(dbDir, { recursive: true });

    console.log(`Backup-Ziel: ${target}`);
    console.log(`  Uploads-Wurzel: ${uploadsRoot()} (Bilder: ${images})`);

    const collections = (await mongoose.connection.db.listCollections().toArray())
      .map(entry => entry.name)
      .filter(name => !name.startsWith('system.'))
      .sort();

    const manifest = {
      createdAt: new Date().toISOString(),
      format: MANIFEST_FORMAT,
      database: mongoose.connection.name,
      collections: [],
      uploads: { dir: path.relative(target, uploadsTarget), files: 0, bytes: 0, referenced: 0, entries: [] }
    };

    for (const name of collections) {
      const file = path.join(dbDir, `${name}.ndjson`);
      const stream = fs.createWriteStream(file);
      let count = 0;
      const cursor = mongoose.connection.db.collection(name).find({});
      for await (const doc of cursor) {
        stream.write(`${JSON.stringify(encode(doc))}\n`);
        count += 1;
      }
      await new Promise(resolve => stream.end(resolve));
      manifest.collections.push({ name, count, file: path.relative(target, file), sha256: await sha256File(file) });
      console.log(`  ${name}: ${count} documents`);
    }

    // Uploads: images and nothing else (temp files are transient).
    const referenced = await referencedImageFilenames();
    manifest.uploads.referenced = referenced.size;
    const copied = new Set();

    // Beide Unterverzeichnisse (v1.12.0: images + files) unabhängig voneinander
    // erfassen — ein Bestand ohne Bilder, aber mit Anhängen, muss genauso
    // vollständig gesichert werden.
    for (const [subdir, sourceDir] of [['images', images], ['files', filesDir()]]) {
      if (!fs.existsSync(sourceDir)) continue;
      const targetDir = path.join(uploadsTarget, subdir);
      fs.mkdirSync(targetDir, { recursive: true });
      for (const entry of fs.readdirSync(sourceDir)) {
        if (entry === '.gitkeep') continue;
        const source = path.join(sourceDir, entry);
        if (!fs.statSync(source).isFile()) continue;
        const destination = path.join(targetDir, entry);
        // Async I/O für den heissen Pfad (v1.14.0): copyFileSync + zwei statSync
        // + Full-File-Hash pro Datei hielten den Event-Loop pro Datei fest.
        await fs.promises.copyFile(source, destination);
        const stats = await fs.promises.stat(destination);
        copied.add(entry);
        manifest.uploads.files += 1;
        manifest.uploads.bytes += stats.size;
        manifest.uploads.entries.push({ name: entry, dir: subdir, size: stats.size, sha256: await sha256File(destination) });
      }
    }

    // Vollständigkeit: Jede von der Datenbank referenzierte Datei muss im Backup
    // sein. Ohne diese Prüfung entstand bei falsch gesetztem UPLOADS_DIR ein
    // „erfolgreiches" Backup ohne ein einziges Bild.
    const missing = [...referenced].filter(name => !copied.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Backup unvollständig: ${missing.length} von ${referenced.size} referenzierten Bilddateien fehlen `
        + `(z. B. ${missing.slice(0, 3).join(', ')}). Quelle: ${images} — passt UPLOADS_DIR? `
        + 'Das unvollständige Backup wurde verworfen.'
      );
    }
    if (referenced.size > 0 && manifest.uploads.files === 0) {
      throw new Error(`Backup unvollständig: Datenbank referenziert ${referenced.size} Bilder, aber keine Datei wurde erfasst (${images}).`);
    }

    fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    applyRetention(keep);

    console.log(`Backup geschrieben: ${target}`);
    console.log(`  ${manifest.collections.length} Collections, ${manifest.uploads.files} Upload-Dateien (${manifest.uploads.bytes} Bytes), ${referenced.size} referenziert`);
    return target;
  } catch (error) {
    // Review v1.14.0: Ein fehlgeschlagener Lauf darf kein keeplocal-* -
    // Verzeichnis hinterlassen — es belegte einen Retention-Slot und
    // verdraengte so die letzten guten Recovery Points.
    fs.rmSync(target, { recursive: true, force: true });
    console.error(`  Abgebrochen, ${target} verworfen: ${error.message}`);
    throw error;
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(name => name.startsWith(PREFIX) && fs.statSync(path.join(BACKUP_DIR, name)).isDirectory())
    .sort();
}

function applyRetention(keep) {
  const backups = listBackups();
  if (backups.length <= keep) return [];
  const removed = backups.slice(0, backups.length - keep);
  for (const name of removed) {
    fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
    console.log(`  Aufbewahrung: ${name} entfernt`);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Verify / Restore
// ---------------------------------------------------------------------------

function resolveBackupDir(dir) {
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

function readManifest(target) {
  const manifestPath = path.join(target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`kein Backup: ${manifestPath} fehlt`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.collections)) {
    throw new Error(`Manifest unlesbar: ${manifestPath} hat keine collections`);
  }
  return manifest;
}

/**
 * Check a recovery point without touching anything: collection files, their
 * checksums and document counts, upload files with size and checksum, and (for
 * format >= 2) that every image the database references is present.
 */
async function verifyBackup(dir) {
  const target = resolveBackupDir(dir);
  const manifest = readManifest(target);
  const report = { target, format: manifest.format || 1, collections: 0, documents: 0, uploads: 0, warnings: [] };

  for (const entry of manifest.collections) {
    const file = path.join(target, entry.file);
    if (!fs.existsSync(file)) throw new Error(`Collection-Datei fehlt: ${entry.file}`);
    const checksum = await sha256File(file);
    if (checksum !== entry.sha256) {
      throw new Error(`Prüfsumme stimmt nicht für ${entry.file} (erwartet ${entry.sha256}, gefunden ${checksum})`);
    }
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
    if (lines !== entry.count) {
      throw new Error(`Dokumentzahl stimmt nicht für ${entry.file} (erwartet ${entry.count}, gefunden ${lines})`);
    }
    report.collections += 1;
    report.documents += lines;
  }

  // Uploads liegen in zwei Unterverzeichnissen (images, files); der Manifest-
  // Eintrag sagt seit Format 2 mit `dir`, wo er hingehört (Default: images,
  // damit Manifeste ohne das Feld lesbar bleiben).
  const uploadsRootInBackup = path.join(target, manifest.uploads?.dir || 'uploads');
  const entries = manifest.uploads?.entries;
  if (Array.isArray(entries)) {
    const present = new Set();
    for (const entry of entries) {
      const file = path.join(uploadsRootInBackup, entry.dir || 'images', entry.name);
      if (!fs.existsSync(file)) throw new Error(`Upload-Datei fehlt: ${entry.name}`);
      const stats = fs.statSync(file);
      if (stats.size !== entry.size) {
        throw new Error(`Upload-Größe stimmt nicht für ${entry.name} (erwartet ${entry.size}, gefunden ${stats.size})`);
      }
      const checksum = await sha256File(file);
      if (checksum !== entry.sha256) {
        throw new Error(`Prüfsumme stimmt nicht für Upload ${entry.name} (erwartet ${entry.sha256}, gefunden ${checksum})`);
      }
      present.add(entry.name);
      report.uploads += 1;
    }
    if ((manifest.uploads?.referenced || 0) > present.size) {
      throw new Error(`Backup unvollständig: ${manifest.uploads.referenced} Bilder referenziert, ${present.size} vorhanden`);
    }
  } else {
    report.warnings.push('Manifest format 1: Uploads haben keine Prüfsummen, nur die Dateien werden gezählt');
    for (const subdir of ['images', 'files']) {
      const legacyDir = path.join(uploadsRootInBackup, subdir);
      if (fs.existsSync(legacyDir)) {
        report.uploads += fs.readdirSync(legacyDir).filter(name => name !== '.gitkeep').length;
      }
    }
    if ((manifest.uploads?.files || 0) !== report.uploads) {
      throw new Error(`Upload-Zahl stimmt nicht (erwartet ${manifest.uploads?.files || 0}, gefunden ${report.uploads})`);
    }
  }

  return report;
}

async function restoreBackup(dir) {
  const target = resolveBackupDir(dir);
  // Alles prüfen, BEVOR das erste deleteMany läuft: ein halbleer restaurierter
  // Zustand ist schlechter als gar keiner.
  const report = await verifyBackup(target);
  const manifest = readManifest(target);
  for (const warning of report.warnings) console.warn(`  Warnung: ${warning}`);

  for (const entry of manifest.collections) {
    const file = path.join(target, entry.file);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const docs = lines.map(line => decode(JSON.parse(line)));
    const collection = mongoose.connection.db.collection(entry.name);
    await collection.deleteMany({});
    if (docs.length > 0) {
      // Chunked, so a large notes collection does not exceed the 16 MB command
      // limit or the driver's buffer. `ordered: false` keeps going after a
      // duplicate-key error instead of leaving a half-filled collection behind;
      // the errors are aggregated and reported below.
      const problems = [];
      for (let index = 0; index < docs.length; index += INSERT_CHUNK) {
        try {
          await collection.insertMany(docs.slice(index, index + INSERT_CHUNK), { ordered: false });
        } catch (error) {
          const writeErrors = error?.writeErrors?.length ?? (error?.result?.getResult?.().writeErrors?.length ?? 0);
          problems.push(`${entry.name} ab Dokument ${index}: ${error.message} (${writeErrors} WriteErrors)`);
        }
      }
      if (problems.length > 0) {
        throw new Error(`Restore unvollständig: ${problems.join(' | ')}`);
      }
    }

    const restored = await collection.countDocuments();
    if (restored !== entry.count) {
      throw new Error(`Restore-Prüfung fehlgeschlagen: ${entry.name} hat ${restored} Dokumente, das Manifest erwartet ${entry.count}`);
    }
    console.log(`  ${entry.name}: ${restored} Dokumente wiederhergestellt`);
  }

  const uploadsRootInBackup = path.join(target, manifest.uploads?.dir || 'uploads');
  let restoredUploads = 0;
  for (const [subdir, destinationDir] of [['images', imagesDir()], ['files', filesDir()]]) {
    const uploadsSource = path.join(uploadsRootInBackup, subdir);
    if (!fs.existsSync(uploadsSource)) continue;
    fs.mkdirSync(destinationDir, { recursive: true });
    for (const entry of fs.readdirSync(uploadsSource)) {
      const source = path.join(uploadsSource, entry);
      if (!fs.statSync(source).isFile()) continue;
      const destination = path.join(destinationDir, entry);
      await fs.promises.copyFile(source, destination);
      // Auch die Kopie prüfen: eine abgeschnittene Datei wäre sonst ein
      // stilles Loch im Restore.
      const expected = manifest.uploads?.entries?.find(item => item.name === entry);
      if (expected && await sha256File(destination) !== expected.sha256) {
        throw new Error(`Prüfsumme stimmt nicht für wiederhergestellte Datei ${entry}`);
      }
      restoredUploads += 1;
    }
  }
  if (restoredUploads === 0 && (manifest.uploads?.files || 0) > 0) {
    throw new Error(`Restore unvollständig: Manifest nennt ${manifest.uploads.files} Uploads, aber ${uploadsRootInBackup} fehlt`);
  }
  if (restoredUploads > 0) {
    console.log(`  uploads: ${restoredUploads} Dateien wiederhergestellt`);
  }

  console.log(`Wiederhergestellt aus ${target} (Backup von ${manifest.createdAt}, ${report.documents} Dokumente, ${report.uploads} Uploads)`);
  return report;
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { keep: DEFAULT_KEEP, list: false, restore: null, verify: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') args.list = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--keep') args.keep = Number(argv[index + 1]) || DEFAULT_KEEP;
    else if (arg === '--restore') args.restore = argv[index + 1];
    else if (arg === '--verify') args.verify = argv[index + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --verify und --list brauchen keine Datenbank.
  if (args.verify) {
    const report = await verifyBackup(args.verify);
    for (const warning of report.warnings) console.warn(`  Warnung: ${warning}`);
    console.log(`Recovery Point OK: ${report.target}`);
    console.log(`  ${report.collections} Collections, ${report.documents} Dokumente, ${report.uploads} Uploads (Format ${report.format})`);
    return;
  }

  if (args.list) {
    const backups = listBackups();
    console.log(backups.length ? backups.join('\n') : 'Keine Backups vorhanden.');
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI ist erforderlich (siehe server/.env.example)');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    if (args.restore) {
      if (!args.force) {
        throw new Error('Wiederherstellen überschreibt die Datenbank: --force ist erforderlich');
      }
      await restoreBackup(args.restore);
    } else {
      await createBackup(args.keep);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Backup fehlgeschlagen:', error.message);
    process.exit(1);
  });
}

module.exports = {
  encode,
  decode,
  createBackup,
  verifyBackup,
  restoreBackup,
  listBackups,
  applyRetention,
  parseArgs,
  referencedImageFilenames,
  BACKUP_DIR
};
