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
  assert.deepEqual(backup.parseArgs([]), { keep: 7, list: false, restore: null, force: false });
  assert.deepEqual(backup.parseArgs(['--keep', '3']), { keep: 3, list: false, restore: null, force: false });
  assert.deepEqual(backup.parseArgs(['--list']), { keep: 7, list: true, restore: null, force: false });
  assert.deepEqual(backup.parseArgs(['--restore', '/tmp/x', '--force']),
    { keep: 7, list: false, restore: '/tmp/x', force: true });
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
  assert.match(source, /index \+= 500/, 'restores insert in chunks');
  assert.match(source, /mongoose\.connection\.db\.listCollections\(\)/);
  assert.match(source, /filter\(name => !name\.startsWith\('system\.'\)\)/);
});
