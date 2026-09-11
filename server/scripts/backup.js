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
 *   MONGODB_URI=... node scripts/backup.js --restore <dir> --force
 *
 * Environment:
 *   MONGODB_URI   (required)
 *   BACKUP_DIR    default <server>/backups
 *   UPLOADS_DIR   default <server>/uploads
 *
 * Restore is destructive and refuses to run without --force.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const SERVER_ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(SERVER_ROOT, 'backups'));
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(SERVER_ROOT, 'uploads'));
const DEFAULT_KEEP = 7;
const PREFIX = 'keeplocal-';

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

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

async function createBackup(keep) {
  const target = path.join(BACKUP_DIR, `${PREFIX}${timestamp()}`);
  const dbDir = path.join(target, 'db');
  const uploadsTarget = path.join(target, 'uploads');
  fs.mkdirSync(dbDir, { recursive: true });

  const collections = (await mongoose.connection.db.listCollections().toArray())
    .map(entry => entry.name)
    .filter(name => !name.startsWith('system.'))
    .sort();

  const manifest = {
    createdAt: new Date().toISOString(),
    format: 1,
    database: mongoose.connection.name,
    collections: [],
    uploads: { files: 0, dir: path.relative(target, uploadsTarget) }
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
    manifest.collections.push({ name, count, file: path.relative(target, file), sha256: sha256File(file) });
    console.log(`  ${name}: ${count} documents`);
  }

  // Uploads: images and nothing else (temp files are transient).
  const imagesDir = path.join(UPLOADS_DIR, 'images');
  if (fs.existsSync(imagesDir)) {
    const targetImages = path.join(uploadsTarget, 'images');
    fs.mkdirSync(targetImages, { recursive: true });
    for (const entry of fs.readdirSync(imagesDir)) {
      if (entry === '.gitkeep') continue;
      fs.copyFileSync(path.join(imagesDir, entry), path.join(targetImages, entry));
      manifest.uploads.files += 1;
    }
  }

  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  applyRetention(keep);

  console.log(`Backup geschrieben: ${target}`);
  console.log(`  ${manifest.collections.length} Collections, ${manifest.uploads.files} Upload-Dateien`);
  return target;
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
// Restore
// ---------------------------------------------------------------------------

async function restoreBackup(dir) {
  const target = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  const manifestPath = path.join(target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`kein Backup: ${manifestPath} fehlt`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  for (const entry of manifest.collections) {
    const file = path.join(target, entry.file);
    if (!fs.existsSync(file)) throw new Error(`Collection-Datei fehlt: ${entry.file}`);
    const checksum = sha256File(file);
    if (checksum !== entry.sha256) {
      throw new Error(`Prüfsumme stimmt nicht für ${entry.file} (erwartet ${entry.sha256}, gefunden ${checksum})`);
    }
  }

  for (const entry of manifest.collections) {
    const file = path.join(target, entry.file);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const docs = lines.map(line => decode(JSON.parse(line)));
    const collection = mongoose.connection.db.collection(entry.name);
    await collection.deleteMany({});
    if (docs.length > 0) {
      // Chunked, so a large notes collection does not exceed the 16 MB command
      // limit or the driver's buffer.
      for (let index = 0; index < docs.length; index += 500) {
        await collection.insertMany(docs.slice(index, index + 500));
      }
    }
    console.log(`  ${entry.name}: ${docs.length} Dokumente wiederhergestellt`);
  }

  const uploadsSource = path.join(target, manifest.uploads?.dir || 'uploads', 'images');
  if (fs.existsSync(uploadsSource)) {
    const imagesDir = path.join(UPLOADS_DIR, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    let files = 0;
    for (const entry of fs.readdirSync(uploadsSource)) {
      fs.copyFileSync(path.join(uploadsSource, entry), path.join(imagesDir, entry));
      files += 1;
    }
    console.log(`  uploads: ${files} Dateien wiederhergestellt`);
  }

  console.log(`Wiederhergestellt aus ${target} (Backup von ${manifest.createdAt})`);
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { keep: DEFAULT_KEEP, list: false, restore: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') args.list = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--keep') args.keep = Number(argv[index + 1]) || DEFAULT_KEEP;
    else if (arg === '--restore') args.restore = argv[index + 1];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI ist erforderlich (siehe server/.env.example)');
  }
  if (args.list) {
    const backups = listBackups();
    console.log(backups.length ? backups.join('\n') : 'Keine Backups vorhanden.');
    return;
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

module.exports = { encode, decode, createBackup, restoreBackup, listBackups, applyRetention, parseArgs, BACKUP_DIR };
