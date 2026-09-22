const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

// Improvement #10: backups were a hand-run mongodump plus a manual copy of the
// uploads, which the split server image cannot even do (no mongodump). The script
// writes one directory with type-preserving NDJSON, a SHA-256 manifest and the
// uploads, and restores it only with --force.

const backup = require('../scripts/backup');

test('values survive the backup round trip with their types', () => {
  const original = {
    _id: new mongoose.Types.ObjectId(),
    title: 'Preis < 100 EUR & Tom <3',
    createdAt: new Date('2026-09-11T10:00:00.000Z'),
    images: [{ filename: 'a.png', size: 12 }],
    nested: { deep: { flag: true, nothing: null } },
    decimal: mongoose.Types.Decimal128.fromString('12.34'),
    binary: Buffer.from([1, 2, 3])
  };

  const wire = JSON.parse(JSON.stringify(backup.encode(original)));
  assert.deepEqual(wire._id, { $oid: original._id.toString() });
  assert.deepEqual(wire.createdAt, { $date: '2026-09-11T10:00:00.000Z' });
  assert.deepEqual(wire.binary, { $binary: Buffer.from([1, 2, 3]).toString('base64') });
  assert.deepEqual(wire.decimal, { $numberDecimal: '12.34' });

  const restored = backup.decode(wire);
  assert.ok(restored._id instanceof mongoose.Types.ObjectId);
  assert.equal(restored._id.toString(), original._id.toString());
  assert.ok(restored.createdAt instanceof Date);
  assert.equal(restored.createdAt.toISOString(), '2026-09-11T10:00:00.000Z');
  assert.ok(Buffer.isBuffer(restored.binary));
  assert.deepEqual([...restored.binary], [1, 2, 3]);
  assert.equal(restored.decimal.toString(), '12.34');
  assert.equal(restored.title, 'Preis < 100 EUR & Tom <3');
  assert.deepEqual(restored.images, [{ filename: 'a.png', size: 12 }]);
  assert.deepEqual(restored.nested, { deep: { flag: true, nothing: null } });
});

test('encoding leaves plain values alone', () => {
  assert.equal(backup.encode('text'), 'text');
  assert.equal(backup.encode(7), 7);
  assert.equal(backup.encode(null), null);
  assert.equal(backup.encode(undefined), undefined);
  assert.deepEqual(backup.encode([]), []);
  assert.equal(backup.decode('text'), 'text');
});

test('a document whose fields are literally named $date is not misread', () => {
  const tricky = { label: { $date: 'not a date', other: 1 } };
  const decoded = backup.decode(JSON.parse(JSON.stringify(backup.encode(tricky))));
  assert.deepEqual(decoded, tricky, 'only single-key markers are decoded');
});

test('CLI arguments are parsed with safe defaults', () => {
  assert.deepEqual(backup.parseArgs([]), { keep: 7, list: false, restore: null, verify: null, force: false });
  assert.deepEqual(backup.parseArgs(['--keep', '3']), { keep: 3, list: false, restore: null, verify: null, force: false });
  assert.deepEqual(backup.parseArgs(['--list']), { keep: 7, list: true, restore: null, verify: null, force: false });
  assert.deepEqual(backup.parseArgs(['--restore', '/tmp/x', '--force']),
    { keep: 7, list: false, restore: '/tmp/x', verify: null, force: true });
  assert.deepEqual(backup.parseArgs(['--verify', '/tmp/x']),
    { keep: 7, list: false, restore: null, verify: '/tmp/x', force: false });
  assert.equal(backup.parseArgs(['--keep', 'nonsense']).keep, 7);
});

test('retention keeps the newest N backups', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-backup-'));
  const names = ['keeplocal-20260101-000000', 'keeplocal-20260102-000000', 'keeplocal-20260103-000000', 'unrelated-dir'];
  for (const name of names) {
    fs.mkdirSync(path.join(directory, name));
  }

  const original = process.env.BACKUP_DIR;
  process.env.BACKUP_DIR = directory;
  // BACKUP_DIR is resolved at require time, so re-read the module.
  delete require.cache[require.resolve('../scripts/backup')];
  const reloaded = require('../scripts/backup');
  assert.equal(reloaded.BACKUP_DIR, path.resolve(directory));

  try {
    assert.deepEqual(reloaded.listBackups(), names.filter(name => name.startsWith('keeplocal-')).sort());
    const removed = reloaded.applyRetention(2);
    assert.deepEqual(removed, ['keeplocal-20260101-000000']);
    assert.equal(fs.existsSync(path.join(directory, 'keeplocal-20260101-000000')), false);
    assert.equal(fs.existsSync(path.join(directory, 'unrelated-dir')), true, 'foreign directories are never touched');
    assert.deepEqual(reloaded.applyRetention(5), []);
  } finally {
    if (original === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = original;
    delete require.cache[require.resolve('../scripts/backup')];
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('restore is guarded: --force, manifest and checksums', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/backup.js'), 'utf8');

  assert.match(source, /--force ist erforderlich/);
  assert.match(source, /if \(!args\.force\) \{/);
  assert.match(source, /Prüfsumme stimmt nicht/);
  assert.match(source, /await collection\.deleteMany\(\{\}\);/);
  assert.match(source, /index \+= INSERT_CHUNK/, 'restores insert in chunks');
  assert.match(source, /mongoose\.connection\.db\.listCollections\(\)/);
  assert.match(source, /filter\(name => !name\.startsWith\('system\.'\)\)/);
});

test('restore verifies everything before the first destructive statement', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/backup.js'), 'utf8');
  const restoreBody = source.slice(source.indexOf('async function restoreBackup('));

  const verifyAt = restoreBody.indexOf('verifyBackup(target)');
  const deleteAt = restoreBody.indexOf('deleteMany({})');
  assert.ok(verifyAt > -1 && deleteAt > -1, 'both steps must exist');
  assert.ok(verifyAt < deleteAt, 'verification must happen before anything is deleted');

  assert.match(restoreBody, /\{ ordered: false \}/, 'a duplicate key must not leave a half-filled collection');
  assert.match(restoreBody, /Restore-Prüfung fehlgeschlagen/, 'the restored counts are compared with the manifest');
  assert.match(restoreBody, /countDocuments\(\)/);
  assert.match(restoreBody, /Prüfsumme stimmt nicht für wiederhergestellte Datei/, 'copies are checksummed after writing');
});

test('a backup is only written when every referenced image was captured', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/backup.js'), 'utf8');

  assert.match(source, /async function referencedImageFilenames\(\)/);
  assert.match(source, /projection: \{ images: 1, files: 1 \}/, 'referenced = images + attachments');
  assert.match(source, /Backup unvollständig: \$\{missing\.length\} von \$\{referenced\.size\}/);
  assert.match(source, /passt UPLOADS_DIR\?/, 'the error must point at the likely cause');
  // Ein verworfenes Backup darf nicht als Recovery Point liegen bleiben.
  assert.equal(source.match(/fs\.rmSync\(target, \{ recursive: true, force: true \}\);/g)?.length, 2);
  assert.match(source, /referenced\.size > 0 && manifest\.uploads\.files === 0/, 'the silent empty-uploads case fails too');

  // Manifest: pro Datei Name, Unterverzeichnis, Größe und Prüfsumme — ohne
  // `dir` sucht verifyBackup Anhänge unter images/ und verwirft das Backup.
  // v1.14.0: Der Backup läuft im Serverprozess — Hash/Kopie sind async
  // (fs.promises + Streaming-Hash), damit der Event-Loop nicht blockiert.
  assert.match(source, /manifest\.uploads\.entries\.push\(\{ name: entry, dir: subdir, size: stats\.size, sha256: await sha256File\(destination\) \}\)/);
  assert.match(source, /await fs\.promises\.copyFile\(source, destination\)/, 'Kopieren ist async');
  assert.match(source, /fs\.createReadStream\(file\)/, 'Hash läuft als Stream');
  assert.match(source, /\[\['images', images\], \['files', filesDir\(\)\]\]/, 'both upload subdirectories are captured independently');
  assert.match(source, /entry\.dir \|\| 'images'/, 'verify resolves the subdir, defaulting to images for old manifests');
  assert.match(source, /\[\['images', imagesDir\(\)\], \['files', filesDir\(\)\]\]/, 'restore writes both subdirectories back');
  assert.match(source, /format: MANIFEST_FORMAT/);
});

test('verifyBackup checks collections, uploads and referenced files', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/backup.js'), 'utf8');

  assert.match(source, /Collection-Datei fehlt/);
  assert.match(source, /Dokumentzahl stimmt nicht/);
  assert.match(source, /Upload-Datei fehlt/);
  assert.match(source, /Upload-Größe stimmt nicht/);
  assert.match(source, /Prüfsumme stimmt nicht für Upload/);
  assert.match(source, /Bilder referenziert, \$\{present\.size\} vorhanden/);
  // Format 1 (ohne Eintragsliste) bleibt lesbar, warnt aber ehrlich.
  assert.match(source, /Manifest format 1: Uploads haben keine Prüfsummen/);
});

test('--verify and --list need no database connection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/backup.js'), 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'));

  const verifyAt = mainBody.indexOf('if (args.verify)');
  const listAt = mainBody.indexOf('if (args.list)');
  const connectAt = mainBody.indexOf('mongoose.connect');
  const uriCheckAt = mainBody.indexOf("MONGODB_URI ist erforderlich");

  assert.ok(verifyAt > -1 && verifyAt < uriCheckAt, '--verify must run without MONGODB_URI');
  assert.ok(listAt > -1 && listAt < uriCheckAt, '--list must run without MONGODB_URI');
  assert.ok(connectAt > uriCheckAt, 'only create/restore connect');
});

test('CI restores a real backup before anybody needs to', () => {
  const ci = fs.readFileSync(path.join(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /Backup\/restore round trip \(real MongoDB\)/);
  assert.match(ci, /run: npm run verify:backup-restore/);
  assert.match(ci, /BACKUP_MONGODB_URI: mongodb:\/\/127\.0\.0\.1:27017\/keeplocal_backup/);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts['verify:backup-restore'], 'node scripts/verify-backup-restore.js');

  const script = fs.readFileSync(path.join(__dirname, '../scripts/verify-backup-restore.js'), 'utf8');
  assert.match(script, /dropDatabase\(\)/, 'the restore must be proven against an emptied database');
  assert.match(script, /backup\|e2e\|test\|ci/, 'refuses to drop a database that is not a test database');
  assert.match(script, /sha256\(original\) === originalSha/, 'restored files are compared byte-for-byte');
});

test('recovery point names cannot collide within the same second', () => {
  // `timestamp()` hat Sekunden-Auflösung. Ein fester Verzeichnisname würde zwei
  // Läufe in derselben Sekunde kollidieren lassen — und weil ein
  // unvollständiges Backup sein Zielverzeichnis verwirft, hätte ein
  // fehlgeschlagener Lauf den vorhandenen Recovery Point gelöscht (in CI
  // passiert, bevor --verify auffiel).
  const source = fs.readFileSync(path.join(__dirname, '../scripts/backup.js'), 'utf8');

  assert.match(source, /fs\.mkdtempSync\(path\.join\(BACKUP_DIR, `\$\{PREFIX\}\$\{timestamp\(\)\}-`\)\)/);
  assert.doesNotMatch(source, /const target = path\.join\(BACKUP_DIR, `\$\{PREFIX\}\$\{timestamp\(\)\}`\)/);
  assert.match(source, /fs\.mkdirSync\(BACKUP_DIR, \{ recursive: true \}\);/, 'the backup root may not exist yet');

  const verifyScript = fs.readFileSync(path.join(__dirname, '../scripts/verify-backup-restore.js'), 'utf8');
  assert.match(verifyScript, /two backups in the same second get distinct directories/);
  assert.match(verifyScript, /the good recovery point survived the failed run/);
});
