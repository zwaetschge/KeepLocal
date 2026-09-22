const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mongoose = require('mongoose');
const userModelPath = require.resolve('../models/User');
const noteModelPath = require.resolve('../models/Note');
const apiKeyModelPath = require.resolve('../models/ApiKey');
const notesServicePath = require.resolve('../services/notesService');
const servicePath = require.resolve('../services/adminService');
const uploadsDir = path.resolve(__dirname, '../uploads/images');

/**
 * Frischer Upload-Wurzelordner fuer einen Test: paths.js loest imagesDir()/
 * filesDir() pro Aufruf ueber UPLOADS_DIR auf, daher reicht das Setzen der
 * Variable vor dem deleteUser-Aufruf. Rueckgabe ist eine Cleanup-Funktion.
 */
function withTempUploads() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-admin-delete-'));
  const images = path.join(root, 'images');
  const files = path.join(root, 'files');
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(files, { recursive: true });
  const previous = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;
  return {
    images,
    files,
    cleanup() {
      if (previous === undefined) {
        delete process.env.UPLOADS_DIR;
      } else {
        process.env.UPLOADS_DIR = previous;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

/**
 * deleteUser mit gemockten Modellen laden (Muster wie im Test darueber).
 * Mit useNotesServiceMock=true landet statt des echten notesService ein
 * Spion im require-Cache, der die Loesch-Aufrufe je Notiz mitzaehlt.
 */
function loadService({ notes, user, onEvent, useNotesServiceMock = false } = {}) {
  const calls = [];
  const targetUser = user || {
    _id: 'target-user',
    isAdmin: false,
    toObject: () => ({ _id: 'target-user' })
  };
  const UserMock = {
    findById: () => thenableUser(targetUser),
    updateMany: async (query, update) => calls.push(['users', query, update]),
    findByIdAndDelete: async id => {
      calls.push(['delete-user', id]);
      if (onEvent) onEvent('delete-user');
    }
  };
  const NoteMock = {
    find: async () => notes || [],
    updateMany: async (query, update) => calls.push(['notes', query, update]),
    deleteMany: async query => {
      calls.push(['delete-notes', query]);
      if (onEvent) onEvent('delete-notes');
    }
  };
  const ApiKeyMock = {
    deleteMany: async query => calls.push(['delete-keys', query])
  };

  delete require.cache[servicePath];
  delete require.cache[notesServicePath];
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[apiKeyModelPath] = { id: apiKeyModelPath, filename: apiKeyModelPath, loaded: true, exports: ApiKeyMock };
  if (useNotesServiceMock) {
    const imageCalls = [];
    const fileCalls = [];
    require.cache[notesServicePath] = {
      id: notesServicePath,
      filename: notesServicePath,
      loaded: true,
      exports: {
        deleteNoteImages: async note => {
          imageCalls.push(note._id);
          if (onEvent) onEvent('images:' + note._id);
        },
        deleteNoteFiles: async note => {
          fileCalls.push(note._id);
          if (onEvent) onEvent('files:' + note._id);
        }
      }
    };
    const service = require(servicePath);
    return { service, calls, imageCalls, fileCalls };
  }
  const service = require(servicePath);
  return { service, calls };
}

function thenableUser(user) {
  return {
    session: async () => user,
    then(resolve, reject) {
      return Promise.resolve(user).then(resolve, reject);
    }
  };
}

test('admin deletion works on standalone MongoDB and cleans all references before files', async () => {
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => {
    throw new Error('transactions are unavailable on standalone MongoDB');
  };

  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = `admin-delete-${process.pid}.png`;
  const filepath = path.join(uploadsDir, filename);
  fs.writeFileSync(filepath, 'test');

  const calls = [];
  const user = { _id: 'target-user', images: [], toObject: () => ({ _id: 'target-user' }) };
  const UserMock = {
    findById: () => thenableUser(user),
    updateMany: async (query, update) => calls.push(['users', query, update]),
    findByIdAndDelete: async id => calls.push(['delete-user', id])
  };
  const NoteMock = {
    find: async () => [{ images: [{ filename }] }],
    updateMany: async (query, update) => calls.push(['notes', query, update]),
    deleteMany: async query => calls.push(['delete-notes', query])
  };
  const ApiKeyMock = {
    deleteMany: async query => calls.push(['delete-keys', query])
  };

  delete require.cache[servicePath];
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[apiKeyModelPath] = { id: apiKeyModelPath, filename: apiKeyModelPath, loaded: true, exports: ApiKeyMock };
  const service = require(servicePath);

  try {
    const deleted = await service.deleteUser('target-user', 'current-user');
    assert.equal(deleted, user);
    assert.equal(calls.some(call => call[0] === 'delete-keys'), true);
    assert.equal(calls.some(call => call[0] === 'users' && JSON.stringify(call[1]).includes('friendRequests.from')), true);
    assert.equal(fs.existsSync(filepath), false);
  } finally {
    mongoose.startSession = originalStartSession;
    fs.rmSync(filepath, { force: true });
  }
});

test('deleteUser removes image files and file attachments of every note', async () => {
  const uploads = withTempUploads();
  const imagePaths = ['note1.png', 'note1-thumb.webp', 'note2.jpg', 'note2-thumb.webp']
    .map(name => path.join(uploads.images, name))
    .map(filepath => {
      fs.writeFileSync(filepath, 'image');
      return filepath;
    });
  const filePaths = ['brief-a.pdf', 'scan-b.pdf']
    .map(name => path.join(uploads.files, name))
    .map(filepath => {
      fs.writeFileSync(filepath, 'pdf');
      return filepath;
    });

  const { service } = loadService({
    notes: [
      {
        _id: 'note-1',
        images: [{ filename: 'note1.png', thumbnailFilename: 'note1-thumb.webp' }],
        files: [{ filename: 'brief-a.pdf', originalName: 'Brief A.pdf' }]
      },
      {
        _id: 'note-2',
        images: [{ filename: 'note2.jpg', thumbnailFilename: 'note2-thumb.webp' }],
        files: [{ filename: 'scan-b.pdf', originalName: 'Scan B.pdf' }]
      }
    ]
  });

  try {
    // Positivkontrolle: die Dateien existieren wirklich, bevor deleteUser laeuft.
    for (const filepath of [...imagePaths, ...filePaths]) {
      assert.equal(fs.existsSync(filepath), true);
    }

    await service.deleteUser('target-user', 'current-user');

    // Bilder inklusive Thumbnails (imagesDir) und Dateianhaenge (filesDir).
    for (const filepath of [...imagePaths, ...filePaths]) {
      assert.equal(fs.existsSync(filepath), false, `${filepath} soll geloescht sein`);
    }
  } finally {
    uploads.cleanup();
  }
});

test('deleteUser tolerates notes without any attachments', async () => {
  const uploads = withTempUploads();

  const { service } = loadService({
    notes: [
      { _id: 'note-1', images: [], files: [] },
      { _id: 'note-2', images: [], files: [] },
      { _id: 'note-3' }
    ]
  });

  try {
    const deleted = await service.deleteUser('target-user', 'current-user');
    assert.equal(deleted._id, 'target-user');
  } finally {
    uploads.cleanup();
  }
});

test('deleteUser deletes file attachments exactly once per note after the database cleanup', async () => {
  const events = [];
  const { service, fileCalls, imageCalls } = loadService({
    notes: [
      { _id: 'note-1', images: [], files: [{ filename: 'a.pdf' }] },
      { _id: 'note-2', images: [], files: [{ filename: 'b.pdf' }] }
    ],
    useNotesServiceMock: true,
    onEvent: name => events.push(name)
  });

  await service.deleteUser('target-user', 'current-user');

  // Pro Notiz GENAU EIN Aufruf — eine doppelte Loeschung wuerde hier als
  // zweiter Eintrag auffallen (die echte Funktion schluckt den zweiten
  // unlink-Fehler still als Warning).
  assert.deepEqual(fileCalls.slice().sort(), ['note-1', 'note-2']);
  assert.deepEqual(imageCalls.slice().sort(), ['note-1', 'note-2']);

  // Vorsaetzlich im Code: erst die komplette DB-Raeumung, dann die Platte.
  assert.equal(events.indexOf('delete-notes') < events.indexOf('files:note-1'), true);
  assert.equal(events.indexOf('delete-user') < events.indexOf('files:note-2'), true);
});
