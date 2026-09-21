const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

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
      exports: { authenticateApiKey: (req, _res, next) => { req.user = { _id: USER, username: 'api' }; next(); } }
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

test('the new v1 routes are registered before /:id', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(notesRouterPath, 'utf8');
  const last = source.lastIndexOf("router.get('/:id'");
  for (const pattern of ["router.get('/tree'", "router.get('/meta'", "router.get('/export/markdown'", "router.post('/import/markdown'"]) {
    const at = source.indexOf(pattern);
    assert.ok(at > -1 && at < last, `${pattern} muss vor /:id registriert sein`);
  }
});
