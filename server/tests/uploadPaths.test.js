const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 6): UPLOADS_DIR war in README/docs/Compose als
// Wurzel dokumentiert, aber nur scripts/backup.js las sie so — App, Uploads und
// Readiness-Check hatten `<server>/uploads` hartkodiert bzw. deuteten dieselbe
// Variable als Bildverzeichnis. Ergebnis bei gesetztem UPLOADS_DIR: grüner
// Health-Check, „Backup geschrieben" mit null Dateien, Restore ohne Bilder.

const pathsPath = require.resolve('../config/paths');
const serverRoot = path.resolve(__dirname, '..');

function loadPaths(env = {}) {
  delete require.cache[pathsPath];
  const saved = {};
  for (const key of ['UPLOADS_DIR', 'BACKUP_DIR']) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const paths = require(pathsPath);
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return { paths, restore };
}

test('without configuration everything stays inside the server tree', () => {
  const { paths, restore } = loadPaths();
  try {
    assert.equal(paths.SERVER_ROOT, serverRoot);
    assert.equal(paths.uploadsRoot(), path.join(serverRoot, 'uploads'));
    assert.equal(paths.imagesDir(), path.join(serverRoot, 'uploads', 'images'));
    assert.equal(paths.tempDir(), path.join(serverRoot, 'uploads', 'temp'));
    assert.equal(paths.backupRoot(), path.join(serverRoot, 'backups'));
  } finally {
    restore();
  }
});

test('UPLOADS_DIR is the root that contains images/ and temp/', () => {
  const { paths, restore } = loadPaths({ UPLOADS_DIR: '/mnt/keeplocal/uploads', BACKUP_DIR: '/mnt/keeplocal/backups' });
  try {
    assert.equal(paths.uploadsRoot(), '/mnt/keeplocal/uploads');
    assert.equal(paths.imagesDir(), '/mnt/keeplocal/uploads/images');
    assert.equal(paths.tempDir(), '/mnt/keeplocal/uploads/temp');
    assert.equal(paths.backupRoot(), '/mnt/keeplocal/backups');
  } finally {
    restore();
  }
});

test('relative values are resolved, not reinterpreted per module', () => {
  const { paths, restore } = loadPaths({ UPLOADS_DIR: 'relative/uploads' });
  try {
    assert.equal(paths.uploadsRoot(), path.resolve(process.cwd(), 'relative/uploads'));
    assert.equal(paths.imagesDir(), path.join(path.resolve(process.cwd(), 'relative/uploads'), 'images'));
  } finally {
    restore();
  }
});

test('ensureUploadDirs creates both directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-paths-'));
  const { paths, restore } = loadPaths({ UPLOADS_DIR: root });
  try {
    const created = paths.ensureUploadDirs();
    assert.equal(created.root, root);
    assert.equal(fs.existsSync(path.join(root, 'images')), true);
    assert.equal(fs.existsSync(path.join(root, 'temp')), true);
  } finally {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no module hardcodes the uploads path any more', () => {
  const consumers = [
    'middleware/upload.js',
    'middleware/secureFileServe.js',
    'services/notesService.js',
    'services/healthService.js',
    'services/storageJanitor.js',
    'routes/notes.js',
    'scripts/backup.js'
  ];
  for (const file of consumers) {
    const source = fs.readFileSync(path.join(serverRoot, file), 'utf8');
    assert.doesNotMatch(source, /'\.\.\/uploads/, `${file} must not hardcode ../uploads`);
    assert.doesNotMatch(source, /"\.\.\/uploads/, `${file} must not hardcode ../uploads`);
    assert.match(source, /require\('\.\.\/config\/paths'\)/, `${file} must resolve paths through config/paths`);
  }
});

test('the readiness probe writes where uploads are actually stored', () => {
  const health = fs.readFileSync(path.join(serverRoot, 'services/healthService.js'), 'utf8');
  assert.match(health, /const UPLOADS_DIR = imagesDir\(\);/);
  assert.match(health, /const probeDir = imagesDir\(\);/, 'the probe must resolve per call, not at import time');
  assert.doesNotMatch(health, /process\.env\.UPLOADS_DIR \|\| path\.resolve\(__dirname, '\.\.\/uploads\/images'\)/);
});
