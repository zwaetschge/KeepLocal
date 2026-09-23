const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cookieParser = require('cookie-parser');

// Audit 2026-09-12 (Top-30 Nr. 21): Die externe v1-API (755 Zeilen) hatte keinen
// einzigen Verhaltenstest — nur eine Doku-Assertion. Und sie war seit dem
// Papierkorb (PR #106) inkonsistent: DELETE löschte weich, antwortete aber
// „Notiz gelöscht", und es gab weder `?permanent`, noch `/restore`, noch einen
// `deleted`-Filter. Ein Sync-Script sah die Notiz verschwinden und konnte sie
// über die API nie zurückholen, während die Swagger-Doku Hartlöschung
// versprach.

const routerPath = require.resolve('../routes/v1/index');
const notesRouterPath = require.resolve('../routes/v1/notes');
const servicePath = require.resolve('../services/notesService');
const apiKeyAuthPath = require.resolve('../middleware/apiKeyAuth');
const apiKeyModelPath = require.resolve('../models/ApiKey');
const userModelPath = require.resolve('../models/User');
const uploadMiddlewarePath = require.resolve('../middleware/upload');
const attachmentUploadPath = require.resolve('../utils/attachmentUpload');
const secureFileServePath = require.resolve('../middleware/secureFileServe');
const authMiddlewarePath = require.resolve('../middleware/auth');
const noteModelPath = require.resolve('../models/Note');

const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NOTE_ID = '64b000000000000000000001';

function loadApi({ withRealKeyGate = false, serviceOverrides = {} } = {}) {
  const calls = [];
  for (const modulePath of [routerPath, notesRouterPath, servicePath, apiKeyAuthPath]) {
    delete require.cache[modulePath];
  }

  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true,
    exports: {
      getAllNotes: async (options) => { calls.push({ op: 'getAllNotes', options }); return { notes: [], pagination: { total: 0 } }; },
      getNoteById: async (id, userId) => { calls.push({ op: 'getNoteById', id, userId }); return { _id: id }; },
      createNote: async () => { calls.push({ op: 'createNote' }); return { _id: NOTE_ID }; },
      updateNote: async () => { calls.push({ op: 'updateNote' }); return { _id: NOTE_ID }; },
      deleteNote: async (id, userId) => {
        calls.push({ op: 'deleteNote', id, userId });
        return { _id: id, deletedAt: new Date('2026-09-12T10:00:00.000Z') };
      },
      purgeNote: async (id, userId) => { calls.push({ op: 'purgeNote', id, userId }); return { _id: id, deletedAt: new Date() }; },
      restoreNote: async (id, userId) => { calls.push({ op: 'restoreNote', id, userId }); return { _id: id, deletedAt: null }; },
      togglePinNote: async () => ({ _id: NOTE_ID }),
      toggleArchiveNote: async () => ({ _id: NOTE_ID }),
      shareNote: async () => ({ _id: NOTE_ID }),
      unshareNote: async () => ({ _id: NOTE_ID }),
      ...serviceOverrides
    }
  };

  if (!withRealKeyGate) {
    require.cache[apiKeyAuthPath] = {
      id: apiKeyAuthPath, filename: apiKeyAuthPath, loaded: true,
      // v1.14.0: requireApiKeyWrite kam dazu (Scopes) — der Stub reicht ihn als
      // Pass-Through durch; die Scope-Logik selbst testet apiKeyAuth.test.js.
      exports: {
        authenticateApiKey: (req, _res, next) => { req.user = { _id: USER, username: 'api' }; next(); },
        requireApiKeyWrite: (_req, _res, next) => next()
      }
    };
  } else {
    require.cache[apiKeyModelPath] = {
      id: apiKeyModelPath, filename: apiKeyModelPath, loaded: true,
      exports: { findByKey: async () => null, updateOne: () => ({ exec: async () => ({}) }) }
    };
    require.cache[userModelPath] = {
      id: userModelPath, filename: userModelPath, loaded: true,
      exports: { findById: () => ({ select: async () => null }) }
    };
  }

  const app = express();
  app.use(express.json());
  app.use(require('../middleware/errorCodes'));
  app.use('/api/v1', require(routerPath));
  return { app, calls };
}

async function withServer(app, run) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('the v1 note list excludes the trash by default and can request it', async () => {
  const { app, calls } = loadApi();
  await withServer(app, async (base) => {
    const plain = await fetch(`${base}/api/v1/notes?page=1&limit=10`);
    assert.equal(plain.status, 200);

    const trashed = await fetch(`${base}/api/v1/notes?deleted=true`);
    assert.equal(trashed.status, 200);
  });

  assert.equal(calls[0].options.deleted, 'false', 'without the parameter the trash stays out');
  assert.equal(calls[1].options.deleted, 'true', 'a sync script can read the trash');
  assert.equal(calls[0].options.userId, USER);
});

test('the v1 note list caps the page size', async () => {
  const { app, calls } = loadApi();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes?limit=5000`);
    assert.equal(response.status, 200);
  });
  assert.equal(calls[0].options.limit, 100, 'limit is capped at 100 like the browser API');
});

test('DELETE moves the note to the trash and says so', async () => {
  const { app, calls } = loadApi();
  const body = await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    return response.json();
  });

  assert.deepEqual(calls.map(call => call.op), ['deleteNote'], 'no purge without ?permanent=true');
  assert.equal(calls[0].userId, USER);
  assert.equal(body.message, 'Notiz in den Papierkorb verschoben');
  assert.equal(body.permanent, false);
  assert.equal(body.deletedAt, '2026-09-12T10:00:00.000Z', 'the caller learns the retention start');
});

test('DELETE ?permanent=true purges a trashed note', async () => {
  const { app, calls } = loadApi();
  const body = await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}?permanent=true`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    return response.json();
  });

  assert.deepEqual(calls.map(call => call.op), ['purgeNote']);
  assert.equal(body.message, 'Notiz endgültig gelöscht');
  assert.equal(body.permanent, true);
});

test('POST /:id/restore brings a trashed note back', async () => {
  const { app, calls } = loadApi();
  const body = await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/restore`, { method: 'POST' });
    assert.equal(response.status, 200);
    return response.json();
  });

  assert.deepEqual(calls.map(call => call.op), ['restoreNote']);
  assert.equal(calls[0].id, NOTE_ID);
  assert.equal(calls[0].userId, USER);
  assert.equal(body.success, true);
  assert.equal(body.data.deletedAt, null);
});

test('a service 404 becomes an API 404 with the documented shape', async () => {
  const { app } = loadApi({
    serviceOverrides: {
      restoreNote: async () => {
        const error = new Error('Notiz nicht gefunden');
        error.statusCode = 404;
        throw error;
      },
      purgeNote: async () => {
        const error = new Error('Notiz nicht gefunden');
        error.statusCode = 404;
        throw error;
      }
    }
  });

  const result = await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/restore`, { method: 'POST' });
    return { status: response.status, body: await response.json() };
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error, 'Notiz nicht gefunden');

  const purge = await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}?permanent=true`, { method: 'DELETE' });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(purge.status, 404, 'purging a note that is not in the trash must not silently succeed');
  assert.equal(purge.body.success, false);
});

test('a lost write race becomes an API 409 with the fresh note, not a 500 (Top-30 Nr. 12)', async () => {
  const currentNote = { _id: NOTE_ID, title: 'Gewinner-Stand', content: 'Zweiter Schreiber war schneller' };
  const { app } = loadApi({
    serviceOverrides: {
      updateNote: async () => {
        const error = new Error('Die Notiz wurde inzwischen geändert');
        error.statusCode = 409;
        error.currentNote = currentNote;
        throw error;
      }
    }
  });

  const result = await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Zu langsam' })
    });
    return { status: response.status, body: await response.json() };
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error, 'Die Notiz wurde inzwischen geändert');
  assert.deepEqual(result.body.currentNote, currentNote,
    'a sync script can retry on top of the returned server state');
});

test('the whole v1 surface sits behind the API key gate', async () => {
  const { app } = loadApi({ withRealKeyGate: true });
  await withServer(app, async (base) => {
    for (const [method, urlPath] of [
      ['GET', '/api/v1/notes'],
      ['GET', '/api/v1/tags'],
      ['GET', '/api/v1/user/me'],
      ['DELETE', `/api/v1/notes/${NOTE_ID}`],
      ['POST', `/api/v1/notes/${NOTE_ID}/restore`]
    ]) {
      const response = await fetch(base + urlPath, { method });
      const body = await response.json();
      assert.equal(response.status, 401, `${method} ${urlPath} must require an API key`);
      assert.equal(body.success, false);
      assert.equal(body.code, 'API_KEY_REQUIRED', `${method} ${urlPath} must carry a stable code`);
    }
  });
});

// ---------------------------------------------------------------------------
// v1.13.0 Nr. 10 — v1-API-Parität: Ordner-Scope, Delta-Sync, Baum, Meta-Sonde,
// Export und Bulk-Import. Sync-Scripts sind die Hauptnutzer der v1, hatten
// aber keinen Zugriff auf alles, was die Web-App kann.
// ---------------------------------------------------------------------------

test('the v1 note list passes folderId and since through to the service', async () => {
  const { app, calls } = loadApi();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes?folderId=root&since=2026-09-01T00:00:00.000Z`);
    assert.equal(response.status, 200);
  });
  assert.equal(calls[0].options.folderId, 'root');
  assert.equal(calls[0].options.since, '2026-09-01T00:00:00.000Z');
});

test('the v1 surface exposes tree, meta, export and bulk import', async () => {
  const { app, calls } = loadApi({
    serviceOverrides: {
      getNoteTree: async (userId, since) => { calls.push({ op: 'getNoteTree', userId, since }); return [{ id: NOTE_ID, shared: true }]; },
      getNotesMeta: async (userId) => { calls.push({ op: 'getNotesMeta', userId }); return { active: 5, archived: 1, trash: 0, maxUpdatedAt: null }; },
      buildMarkdownExport: async (userId) => { calls.push({ op: 'buildMarkdownExport', userId }); return Buffer.from('PK-fake'); },
      importMarkdownNotes: async (userId, items, options) => { calls.push({ op: 'importMarkdownNotes', userId, items, options }); return { created: items.length, foldersCreated: 0, folderIds: [] }; }
    }
  });

  await withServer(app, async (base) => {
    const tree = await fetch(`${base}/api/v1/notes/tree?since=2026-09-01T00:00:00.000Z`);
    assert.equal(tree.status, 200);
    const treeBody = await tree.json();
    assert.deepEqual(treeBody.data, [{ id: NOTE_ID, shared: true }]);

    const meta = await fetch(`${base}/api/v1/notes/meta`);
    assert.equal(meta.status, 200);
    assert.equal((await meta.json()).data.active, 5);

    const exported = await fetch(`${base}/api/v1/notes/export/markdown`);
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('content-type'), 'application/zip');

    const imported = await fetch(`${base}/api/v1/notes/import/markdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ path: 'A', title: 'a', content: 'x' }] })
    });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).data.created, 1);

    const noItems = await fetch(`${base}/api/v1/notes/import/markdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: 'nope' })
    });
    assert.equal(noItems.status, 400);
  });

  assert.equal(calls.find((c) => c.op === 'getNoteTree').since, '2026-09-01T00:00:00.000Z');
});

// v1.16.0: Die v1-Route teilt sich das Export-Gate mit der Session-Route — der
// Gate-Schlüssel ist der NUTZER, nicht der Auth-Weg. Ein read-only Key kann
// denselben speicherhungrigen Export anstoßen wie der Browser; der 429er-Fehler-
// Körper trägt hier den v1-Envelope (success: false).
test('the v1 export shares the per-user concurrency gate (429 while busy)', async () => {
  const { acquire } = require('../utils/concurrencyGate');
  const { app, calls } = loadApi({
    serviceOverrides: {
      buildMarkdownExport: async () => { calls.push({ op: 'buildMarkdownExport' }); return Buffer.from('PK'); }
    }
  });

  const gate = acquire(`export:${USER}`, 1);
  assert.equal(gate.acquired, true);
  try {
    await withServer(app, async (base) => {
      const busy = await fetch(`${base}/api/v1/notes/export/markdown`);
      const body = await busy.json();

      assert.equal(busy.status, 429);
      assert.equal(busy.headers.get('retry-after'), '30');
      assert.equal(body.success, false);
      assert.equal(body.code, 'EXPORT_BUSY');
      assert.deepEqual(calls, []);

      gate.release();

      const ok = await fetch(`${base}/api/v1/notes/export/markdown`);
      assert.equal(ok.status, 200);
      assert.equal(calls.length, 1);
    });
  } finally {
    gate.release(); // idempotent
  }
});

test('the new v1 routes are registered before /:id', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(notesRouterPath, 'utf8');
  const last = source.lastIndexOf("router.get('/:id'");
  for (const pattern of ["router.get('/tree'", "router.get('/meta'", "router.get('/export/markdown'", "router.post('/import/markdown'"]) {
    const at = source.indexOf(pattern);
    assert.ok(at > -1 && at < last, `${pattern} muss vor /:id registriert sein`);
  }
});

// v1.14.0 Nr. 8 + Nr. 10: Die v1-Antwort enthielt counts/tags nie — die vier
// Zusaetzqueries pro Listenaufruf entfallen (includeMeta: false). Und alle
// neun mutierenden Routen tragen den Write-Guard für Scopes.

test('the v1 note list never pays for counts or the tag cloud', async () => {
  const { app, calls } = loadApi();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/notes?page=1&limit=10`);
    assert.equal(response.status, 200);
  });
  assert.equal(calls[0].options.includeMeta, false, 'v1 fragt includeMeta:false an');
});

test('every mutating v1 route sits behind the API-key write guard', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/v1/notes.js'), 'utf8');
  const guarded = source.match(/router\.(post|put|delete)\('[^']+', requireApiKeyWrite,/g) || [];
  assert.equal(guarded.length, 13,
    'dreizehn Write-Routes: create/update/delete/restore/pin/archive/share×2/import + die vier Upload-Routen (v1.15.0)');
  // v1.15.0: Auch die neuen Anhang-Routen tragen den Write-Guard UND die
  // Demo-Sperre — ein read-only Key darf keine Dateien auf den Server bringen.
  // Bei den POST-Routen sitzt dazwischen der v1-Envelope (die geteilte
  // Pipeline antwortet sonst im Session-Format, siehe v1ResponseEnvelope).
  for (const route of [
    "router.post('/:id/images'",
    "router.post('/:id/files'"
  ]) {
    const at = source.indexOf(route);
    assert.ok(at > -1, `${route} ist registriert`);
    assert.match(source.slice(at, at + 170), /requireApiKeyWrite, v1ResponseEnvelope, blockDemoUploads,/,
      `${route} sitzt hinter Write-Guard, Envelope und Demo-Sperre`);
  }
  for (const route of [
    "router.delete('/:id/images/:filename'",
    "router.delete('/:id/files/:filename'"
  ]) {
    const at = source.indexOf(route);
    assert.ok(at > -1, `${route} ist registriert`);
    assert.match(source.slice(at, at + 160), /requireApiKeyWrite, blockDemoUploads,/,
      `${route} sitzt hinter Write-Guard und Demo-Sperre`);
  }
  // Lese-Routen bleiben bewusst ohne Guard — ein read-only Key bleibt nützlich.
  const plain = source.match(/router\.(get)\('[^']+',\s*async/g) || [];
  assert.ok(plain.length >= 5, 'die GET-Routen tragen keinen Write-Guard');
  assert.doesNotMatch(source, /router\.get\('[^']+', requireApiKeyWrite/);
});

// ---------------------------------------------------------------------------
// v1.15.0 — Anhänge über die v1-API: Die vier neuen Upload-Routen laufen hinter
// dem Key-Gate durch dieselbe Pipeline wie die Web-App (utils/attachmentUpload
// — Magic-Bytes, Limits, Temp-then-move), und GET /uploads akzeptiert endlich
// auch den X-API-Key. Vorher konnte ein v1-Client hochladen, die Datei-URL
// aber nie abrufen, weil dieses Mount nur die Session kannte.
//
// Das Harness unten fährt echte Multer- und Magic-Byte-Prüfung gegen ein
// Temp-Upload-Verzeichnis; nur die Datenbank-Schicht ist Attrappe. Weil
// middleware/upload seine Temp-Pfade beim require einfriert, wird die
// Modul-Kette nach dem Setzen von UPLOADS_DIR neu geladen.
// ---------------------------------------------------------------------------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n');
const STORED_IMAGE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
const STORED_THUMB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-thumb.webp';

// Module, die UPLOADS_DIR beim require einfrieren oder Modell-Attrappen binden.
const UPLOAD_MODULE_CHAIN = [
  routerPath, notesRouterPath, servicePath, apiKeyAuthPath,
  uploadMiddlewarePath, attachmentUploadPath, secureFileServePath,
  authMiddlewarePath, apiKeyModelPath, userModelPath, noteModelPath
];

function imageForm(content = PNG_BYTES, name = 'grafik.png') {
  const form = new FormData();
  form.append('images', new Blob([content], { type: 'image/png' }), name);
  return form;
}

function pdfForm(content = PDF_BYTES, name = 'anhang.pdf') {
  const form = new FormData();
  form.append('files', new Blob([content], { type: 'application/pdf' }), name);
  return form;
}

function loadUploadApi({ keyScopes = ['write'], isDemo = false, serviceOverrides = {} } = {}) {
  const calls = [];
  const uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-v1-uploads-'));
  process.env.UPLOADS_DIR = uploadsRoot;
  for (const dir of ['images', 'files', 'temp']) {
    fs.mkdirSync(path.join(uploadsRoot, dir), { recursive: true });
  }

  for (const modulePath of UPLOAD_MODULE_CHAIN) {
    delete require.cache[modulePath];
  }

  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true,
    exports: {
      getEditableNoteById: async (id, userId) => {
        calls.push({ op: 'getEditableNoteById', id, userId });
        return { _id: id, userId, images: [], files: [] };
      },
      validateImageDimensions: async () => {},
      generateThumbnail: async (filename) => { calls.push({ op: 'generateThumbnail', filename }); return null; },
      stripImageMetadata: async () => null,
      addImages: async (id, userId, imageData) => { calls.push({ op: 'addImages', id, userId, imageData }); return { _id: id, images: imageData }; },
      addFiles: async (id, userId, fileData) => { calls.push({ op: 'addFiles', id, userId, fileData }); return { _id: id, files: fileData }; },
      removeImage: async (id, userId, filename) => { calls.push({ op: 'removeImage', id, userId, filename }); return { _id: id, images: [] }; },
      removeFile: async (id, userId, filename) => { calls.push({ op: 'removeFile', id, userId, filename }); return { _id: id, files: [] }; },
      ...serviceOverrides
    }
  };

  // Echter authenticateApiKey/requireApiKeyWrite — nur die Modelle sind Attrappen.
  require.cache[apiKeyModelPath] = {
    id: apiKeyModelPath, filename: apiKeyModelPath, loaded: true,
    exports: {
      findByKey: async (key) => (key === 'test-key' ? { _id: 'key-doc', userId: USER, scopes: keyScopes } : null),
      updateOne: () => ({ exec: async () => {} })
    }
  };
  require.cache[userModelPath] = {
    id: userModelPath, filename: userModelPath, loaded: true,
    exports: { findById: () => ({ select: async () => ({ _id: USER, isDemo }) }) }
  };
  // secureFileServe löst die Datei über eine Notiz auf — der Besitzer passt zum Key.
  require.cache[noteModelPath] = {
    id: noteModelPath, filename: noteModelPath, loaded: true,
    exports: { findOne: async () => ({ _id: NOTE_ID, userId: USER, sharedWith: [], images: [], files: [] }) }
  };
  // Cookie-Zweig des Dual-Auth: Die JWT-Mechanik selbst gehört in die Auth-
  // Suite — hier genügt der Nachweis, dass authenticateToken erreicht wird.
  require.cache[authMiddlewarePath] = {
    id: authMiddlewarePath, filename: authMiddlewarePath, loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => { req.user = { _id: USER, isDemo: false }; next(); },
      AUTH_COOKIE_NAME: 'kl_session'
    }
  };

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(require('../middleware/errorCodes'));
  // Gleiches Mount wie in server.js: /uploads mit Dual-Auth, /api/v1 mit Key-Gate.
  app.get('/uploads/*', require(apiKeyAuthPath).authenticateSessionOrApiKey, require(secureFileServePath));
  app.use('/api/v1', require(routerPath));
  return { app, calls, uploadsRoot };
}

async function withUploadApi(options, run) {
  const context = loadUploadApi(options);
  try {
    return await withServer(context.app, (base) => run(base, context));
  } finally {
    delete process.env.UPLOADS_DIR;
    fs.rmSync(context.uploadsRoot, { recursive: true, force: true });
    for (const modulePath of UPLOAD_MODULE_CHAIN) {
      delete require.cache[modulePath];
    }
  }
}

test('v1 image upload via a write key answers with the v1 success envelope', async () => {
  const body = await withUploadApi({}, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/images`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: imageForm()
    });
    assert.equal(response.status, 200);
    return response.json();
  });

  assert.equal(body.success, true,
    'die Swagger-Doku der Route und jede andere v1-Antwort nutzen { success, data }');
  assert.equal(body.data?.images?.length, 1, 'die Notiz trägt den neuen images-Eintrag');
});

test('v1 pdf upload via a write key answers with the v1 success envelope', async () => {
  const body = await withUploadApi({}, async (base) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/files`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: pdfForm()
    });
    assert.equal(response.status, 200);
    return response.json();
  });

  assert.equal(body.success, true,
    'die Swagger-Doku der Route und jede andere v1-Antwort nutzen { success, data }');
  assert.equal(body.data?.files?.length, 1, 'die Notiz trägt den neuen files-Eintrag');
});

test('v1 image upload runs the web pipeline: random hex name, moved out of temp', async () => {
  await withUploadApi({}, async (base, { calls, uploadsRoot }) => {
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/images`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: imageForm()
    });
    assert.equal(response.status, 200);

    const add = calls.find((c) => c.op === 'addImages');
    assert.equal(add.id, NOTE_ID);
    assert.equal(add.userId, USER);
    const [entry] = add.imageData;
    assert.match(entry.filename, /^[a-f0-9]{48}\.png$/, 'der Client-Dateiname stellt nie den Speichernamen');
    assert.equal(entry.url, `/uploads/images/${entry.filename}`);
    assert.ok(fs.existsSync(path.join(uploadsRoot, 'images', entry.filename)),
      'die validierte Datei liegt final im freigegebenen images-Verzeichnis');
    assert.ok(!fs.existsSync(path.join(uploadsRoot, 'images', 'grafik.png')), 'kein Client-Name auf der Platte');
    assert.deepEqual(fs.readdirSync(path.join(uploadsRoot, 'temp')), [], 'aus temp/ wurde verschoben, nicht kopiert');
  });
});

test('v1 pdf upload verifies the %PDF- magic bytes and keeps the original name as metadata', async () => {
  await withUploadApi({}, async (base, { calls, uploadsRoot }) => {
    const spoofed = await fetch(`${base}/api/v1/notes/${NOTE_ID}/files`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: pdfForm(Buffer.from('<html>kein pdf</html>'), 'fake.pdf')
    });
    assert.equal(spoofed.status, 400, 'ein Umbenanntes darf nie in files/ landen');
    assert.match((await spoofed.json()).error, /Ungültige PDF-Dateien erkannt/);

    const good = await fetch(`${base}/api/v1/notes/${NOTE_ID}/files`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: pdfForm()
    });
    assert.equal(good.status, 200);

    const add = calls.find((c) => c.op === 'addFiles');
    const [entry] = add.fileData;
    assert.equal(entry.originalName, 'anhang.pdf');
    assert.equal(entry.mimetype, 'application/pdf');
    assert.equal(entry.url, `/uploads/files/${entry.filename}`);
    assert.ok(fs.existsSync(path.join(uploadsRoot, 'files', entry.filename)));
    assert.deepEqual(fs.readdirSync(path.join(uploadsRoot, 'temp')), [],
      'auch der abgelehnte Fake ist weg, das echte verschoben');
    assert.equal(calls.some((c) => c.op === 'addImages'), false, 'der files-Upload rührt images nicht an');
  });
});

test('a read-only key is rejected with 403 before anything is written', async () => {
  await withUploadApi({ keyScopes: ['read'] }, async (base, { calls, uploadsRoot }) => {
    const image = await fetch(`${base}/api/v1/notes/${NOTE_ID}/images`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: imageForm()
    });
    assert.equal(image.status, 403);
    const imageBody = await image.json();
    assert.equal(imageBody.success, false);
    assert.match(imageBody.error, /schreibgeschützt/);

    const pdf = await fetch(`${base}/api/v1/notes/${NOTE_ID}/files`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: pdfForm()
    });
    assert.equal(pdf.status, 403, 'der Guard gilt für beide Upload-Arten');

    assert.equal(calls.some((c) => c.op === 'addImages' || c.op === 'addFiles'), false);
    assert.deepEqual(fs.readdirSync(path.join(uploadsRoot, 'temp')), [],
      'requireApiKeyWrite läuft vor Multer — nicht mal ein Temp-File entsteht');
  });
});

test('v1 image delete removes the note entry, the file and its thumbnail', async () => {
  let calls, uploadsRoot;
  await withUploadApi({}, async (base, context) => {
    calls = context.calls;
    uploadsRoot = context.uploadsRoot;
    const imagesDir = path.join(uploadsRoot, 'images');
    fs.writeFileSync(path.join(imagesDir, STORED_IMAGE), PNG_BYTES);
    fs.writeFileSync(path.join(imagesDir, STORED_THUMB), Buffer.from('webp'));

    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/images/${STORED_IMAGE}`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'test-key' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data.images, [], 'die Notiz antwortet ohne den Eintrag');

    assert.equal(fs.existsSync(path.join(imagesDir, STORED_IMAGE)), false, 'die Bilddatei wird mitgelöscht');
    assert.equal(fs.existsSync(path.join(imagesDir, STORED_THUMB)), false, 'das Thumbnail wird mitgelöscht');

    // Pfad-Traversal am Dateinamen scheitert am Safe-Name-Guard, bevor der
    // Service etwas anfasst.
    const traversal = await fetch(`${base}/api/v1/notes/${NOTE_ID}/images/..%2F..%2Fsecret.png`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'test-key' }
    });
    assert.equal(traversal.status, 400);
  });

  assert.deepEqual(calls.find((c) => c.op === 'removeImage'),
    { op: 'removeImage', id: NOTE_ID, userId: USER, filename: STORED_IMAGE });
});

test('GET /uploads serves a note file with only the X-API-Key header', async () => {
  await withUploadApi({ keyScopes: ['read'] }, async (base, { uploadsRoot }) => {
    fs.writeFileSync(path.join(uploadsRoot, 'images', STORED_IMAGE), PNG_BYTES);

    const response = await fetch(`${base}/uploads/images/${STORED_IMAGE}`, {
      headers: { 'x-api-key': 'test-key' }
    });
    assert.equal(response.status, 200, 'hochladen konnte ein Skript noch nie mit Session — genau dafür ist der Key-Weg da');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(PNG_BYTES), 'bytengleich ausgeliefert');
  });
});

test('GET /uploads also accepts the session cookie alone', async () => {
  await withUploadApi({}, async (base, { uploadsRoot }) => {
    fs.writeFileSync(path.join(uploadsRoot, 'images', STORED_IMAGE), PNG_BYTES);

    const response = await fetch(`${base}/uploads/images/${STORED_IMAGE}`, {
      headers: { cookie: 'kl_session=signiert' }
    });
    assert.equal(response.status, 200, 'der Browser-Weg läuft unverändert über authenticateToken');
  });
});

test('GET /uploads without credentials names both auth paths in the 401', async () => {
  const body = await withUploadApi({}, async (base) => {
    const response = await fetch(`${base}/uploads/images/${STORED_IMAGE}`);
    assert.equal(response.status, 401);
    return response.json();
  });

  assert.equal(body.success, false);
  assert.match(body.error, /Session-Cookie/);
  assert.match(body.error, /X-API-Key/, 'der Fehlertext nennt beide Wege, damit ein Skript-Autor weiterweiß');
});

test('the demo block answers in the v1 envelope and keeps its code/feature fields', async () => {
  // Review v1.15.0 (Envelope-Fehlerpfade): Der Envelope verpackt nur Antworten
  // OHNE success-Feld. Die Demo-Sperre (blockDemoUploads) antwortet nacktes
  // { error, code, feature } — der Spread im Envelope muss alle drei Felder
  // behalten UND success: false dazulegen, sonst sieht ein v1-Skript einen
  // Erfolgs-Body (success === undefined ist kein false) und stolpert über die
  // fehlende Fehlersignalisierung.
  let calls;
  const body = await withUploadApi({ isDemo: true }, async (base, context) => {
    calls = context.calls;
    const response = await fetch(`${base}/api/v1/notes/${NOTE_ID}/images`, {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
      body: imageForm()
    });
    assert.equal(response.status, 403);
    return response.json();
  });

  assert.equal(body.success, false, 'v1-Clients prüfen success — undefined wäre kein Fehler');
  assert.equal(body.error, 'Diese Funktion ist in der oeffentlichen Demo deaktiviert.');
  assert.equal(body.code, 'DEMO_FEATURE_DISABLED', 'stabil maschinenlesbar');
  assert.equal(body.feature, 'uploads');

  assert.equal(calls.some((c) => c.op === 'addImages'), false);
});
