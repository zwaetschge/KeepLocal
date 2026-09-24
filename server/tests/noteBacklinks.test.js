const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');

// Backlinks (v1.16.0): „Erwähnt in“ lief der Web-Client über das geladene
// 50er-Fenster aus — bei vollem Korpus (Trilium-Import) fast immer leer oder
// falsch. Der Server sucht seit v1.16.0 über das echte Korpus; diese Tests
// pinnen die Such-Prädikate und die Route.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/notes');

const NOTE_ID = '507f1f77bcf86cd799439011';
const OWNER_ID = '507f191e810c19729de860ea';

function loadService(NoteMock) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: {} };
  return require(servicePath);
}

test('getNoteBacklinks sucht [[Titel]] über das eigene-und-geteilte Korpus', async () => {
  const seen = {};
  const chain = {
    select() { return this; },
    sort(value) { seen.sort = value; return this; },
    limit(value) { seen.limit = value; return this; },
    lean: async () => [
      { _id: 'source-1', title: 'Quelle', updatedAt: new Date('2026-09-22T10:00:00Z') }
    ]
  };
  const service = loadService({
    findOne: (query) => {
      seen.targetQuery = query;
      return { select: () => ({ lean: async () => ({ _id: NOTE_ID, title: 'Rezepte: Desserts!' }) }) };
    },
    find: (query) => { seen.find = query; return chain; }
  });

  const backlinks = await service.getNoteBacklinks(NOTE_ID, OWNER_ID);

  // Die erwähnte Notiz selbst: eigene-oder-geteilte, nicht gelöscht.
  assert.equal(seen.targetQuery._id, NOTE_ID);
  assert.equal(seen.targetQuery.deletedAt, null);

  // Die suchende Query: eigenes + geteiltes Korpus, ohne Papierkorb, ohne
  // Archiv, ohne die Notiz selbst, Titel als escaped Literal in [[]].
  assert.equal(seen.find.deletedAt, null);
  assert.equal(seen.find.isArchived, false);
  assert.deepEqual(seen.find._id, { $ne: NOTE_ID });
  assert.ok(Array.isArray(seen.find.$or));
  // Regex-Metazeichen im Titel sind escaped — „Rezepte: Desserts!“ trägt
  // keins, deshalb hier ein Titel mit Klammern:
  assert.equal(seen.find.content.$regex.source, '\\[\\[Rezepte: Desserts!\\]\\]');
  assert.equal(seen.find.content.$regex.flags, 'i', 'case-insensitiv für importierte Schreibweisen');

  assert.deepEqual(seen.sort, { updatedAt: -1, _id: -1 });
  assert.equal(seen.limit, 50, 'Antwort ist auf 50 Erwähnungen gecappt');
  assert.deepEqual(backlinks, [{ id: 'source-1', title: 'Quelle', updatedAt: new Date('2026-09-22T10:00:00Z') }]);
});

test('getNoteBacklinks escaped Regex-Metazeichen im Titel', async () => {
  const seen = {};
  const chain = {
    select() { return this; },
    sort() { return this; },
    limit(value) { seen.limit = value; return this; },
    lean: async () => []
  };
  const service = loadService({
    findOne: () => ({ select: () => ({ lean: async () => ({ _id: NOTE_ID, title: 'C++ (und [C])?' }) }) }),
    find: (query) => { seen.find = query; return chain; }
  });

  await service.getNoteBacklinks(NOTE_ID, OWNER_ID);

  assert.equal(seen.find.content.$regex.source, '\\[\\[C\\+\\+ \\(und \\[C\\]\\)\\?\\]\\]',
    'Metazeichen dürfen keine eigene Regex-Bedeutung bekommen');
});

test('getNoteBacklinks: leere Titel und fehlende Notiz sind kein Fehler-Fall', async () => {
  let findCalls = 0;
  const service = loadService({
    findOne: () => ({ select: () => ({ lean: async () => ({ _id: NOTE_ID, title: '   ' }) }) }),
    find: () => { findCalls += 1; throw new Error('darf nicht laufen'); }
  });
  assert.deepEqual(await service.getNoteBacklinks(NOTE_ID, OWNER_ID), [],
    'Notiz ohne Titel hat keinen Wiki-Link — keine Suche nötig');

  const missing = loadService({
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
    find: () => { throw new Error('darf nicht laufen'); }
  });
  await assert.rejects(
    missing.getNoteBacklinks('507f1f77bcf86cd799439099', OWNER_ID),
    (error) => {
      assert.equal(error.statusCode, 404);
      return true;
    },
    'fremde/gelöschte Notiz: 404 wie jeder andere Lese-Pfad'
  );
  assert.equal(findCalls, 0);
});

function loadRouter(serviceMock) {
  for (const p of [routerPath, servicePath, authPath]) delete require.cache[p];
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: serviceMock };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: { authenticateToken: (req, _res, next) => { req.user = { _id: OWNER_ID, isDemo: false }; next(); } }
  };
  return require(routerPath);
}

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/notes', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/notes`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [routerPath, servicePath, authPath]) delete require.cache[p];
  }
}

test('GET /api/notes/:id/backlinks antwortet mit der Erwähnten-Liste', async () => {
  const calls = [];
  const router = loadRouter({
    getNoteBacklinks: async (id, userId) => {
      calls.push([id, userId]);
      return [{ id: 'source-1', title: 'Quelle', updatedAt: '2026-09-22T10:00:00.000Z' }];
    }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/${NOTE_ID}/backlinks`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[NOTE_ID, OWNER_ID]]);
    assert.deepEqual(body, [{ id: 'source-1', title: 'Quelle', updatedAt: '2026-09-22T10:00:00.000Z' }]);
  });
});

test('GET /api/notes/:id/backlinks muss vor /:id registriert sein', async () => {
  const calls = [];
  const router = loadRouter({
    getNoteBacklinks: async () => { calls.push('backlinks'); return []; },
    getNoteById: async () => { calls.push('getNoteById'); throw new Error('falscher Handler'); }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/${NOTE_ID}/backlinks`);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['backlinks'], 'nicht /:id als ID „backlinks“ fressen lassen');
  });
});

// Verdrahtung auf der Client-Seite: Das Modal fragt den Endpoint selbst ab
// (kein Prop-Plumbing mehr durch App/useFolderFeatures über das Fenster).
test('das Web-Frontend holt Backlinks vom Endpoint statt aus dem Fenster', () => {
  const fs = require('node:fs');
  const endpoints = fs.readFileSync(path.join(__dirname, '../../client/src/constants/api.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '../../client/src/services/api/notesAPI.js'), 'utf8');
  const modal = fs.readFileSync(path.join(__dirname, '../../client/src/components/NoteModal.jsx'), 'utf8');
  const features = fs.readFileSync(path.join(__dirname, '../../client/src/hooks/useFolderFeatures.js'), 'utf8');

  assert.match(endpoints, /BACKLINKS: \(id\) => `\/api\/notes\/\$\{id\}\/backlinks`/);
  assert.match(api, /getBacklinks:\s*\(id, options = \{\}\) =>/);
  assert.match(modal, /notesAPI\.getBacklinks\(backlinkNoteId\)/);
  assert.doesNotMatch(features, /const backlinks = useMemo/,
    'die Fenster-Berechnung ist weg — sonst lügt die Liste bei vollem Bestand wieder');
});
