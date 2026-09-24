const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Audit 2026-09-12 (Top-30 Nr. 5, Zählseite): `notesService.buildNotesQuery`
// filtert den Papierkorb korrekt, vier Pfade ausserhalb des Services taten es
// nicht — Tag-Liste und Profil-NoteCount im externen v1-API, die
// Admin-Statistik und das Demo-Quota. Überall dort zählten gelöschte Notizen
// mit, also zeigten Sidebar/Profil/Admin andere Zahlen als die Notizliste, und
// Demo-Nutzer liefen früher in das 429.

const noteModelPath = require.resolve('../models/Note');
const notesServicePath = require.resolve('../services/notesService');
const USER = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function mockNote(captured, { countValue = 0 } = {}) {
  return {
    aggregate: async (pipeline) => { captured.pipelines.push(pipeline); return []; },
    countDocuments: async (filter) => { captured.counts.push(filter); return countValue; },
    find: (filter) => ({
      select: () => ({
        lean: async () => [],
        sort: () => ({ limit: async () => [] })
      })
    }),
    deleteMany: async (filter) => { captured.deleteMany.push(filter); return { deletedCount: filter._id?.$in?.length ?? 0 }; }
  };
}

async function callRoute(routerPath, url, { captured, countValue = 0 } = {}) {
  for (const modulePath of [routerPath, notesServicePath]) delete require.cache[modulePath];
  require.cache[noteModelPath] = {
    id: noteModelPath, filename: noteModelPath, loaded: true,
    exports: mockNote(captured, { countValue })
  };
  const router = require(routerPath);

  const app = express();
  app.use((req, _res, next) => { req.user = { _id: USER, username: 'admin', email: 'a@example.com', isAdmin: true }; next(); });
  app.use(router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: response.status, body: await response.json().catch(() => null) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the v1 tag list ignores trashed notes', async () => {
  const captured = { pipelines: [], counts: [], deleteMany: [] };
  const result = await callRoute(require.resolve('../routes/v1/tags'), '/', { captured });

  assert.equal(result.status, 200);
  const match = captured.pipelines[0].find((stage) => stage.$match);
  assert.ok(match, 'the aggregation must start with a $match stage');
  assert.equal(match.$match.deletedAt, null, 'trashed notes must not add tags or counts');
  assert.equal(match.$match.isArchived, false);
});

test('the v1 profile note count ignores trashed notes', async () => {
  const captured = { pipelines: [], counts: [], deleteMany: [] };
  const result = await callRoute(require.resolve('../routes/v1/user'), '/me', { captured, countValue: 7 });

  assert.equal(result.status, 200);
  assert.equal(captured.counts.length, 1);
  assert.equal(captured.counts[0].deletedAt, null);
  assert.deepEqual(captured.counts[0].$or, [{ userId: USER }, { sharedWith: USER }]);
  assert.equal(result.body.data.noteCount, 7);
});

test('the demo quota counts visible notes only', async () => {
  const { createDemoNoteLimitMiddleware } = require('../middleware/demoPolicy');
  const captured = [];
  const middleware = createDemoNoteLimitMiddleware(async (filter) => { captured.push(filter); return 0; });

  const req = { user: { _id: USER, isDemo: true } };
  let finished = false;
  const res = {
    once: () => {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { finished = true; this.payload = payload; return this; }
  };
  await middleware(req, res, () => { finished = true; });

  assert.equal(finished, true, 'the request must pass');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].deletedAt, null, 'a demo user filling the trash must not hit the quota');
  assert.equal(captured[0].userId, USER);
});

test('emptying the trash deletes exactly the notes it read', async () => {
  const captured = { findOneAndDelete: [] };
  const trashed = [
    { _id: 'n1', images: [{ filename: 'a.png' }] },
    { _id: 'n2', images: [] }
  ];
  const deletedImages = [];

  delete require.cache[notesServicePath];
  require.cache[noteModelPath] = {
    id: noteModelPath, filename: noteModelPath, loaded: true,
    exports: {
      find: () => ({ select: () => Promise.resolve(trashed) }),
      // v1.18.0: eine bedingte Löschung pro gelesener Notiz statt einem
      // deleteMany über die ganze Id-Liste.
      findOneAndDelete: (query) => {
        captured.findOneAndDelete.push(query);
        const hit = trashed.find((note) => String(note._id) === String(query._id));
        return { lean: async () => (hit ? { ...hit } : null) };
      },
      findOneAndUpdate: async () => null,
      exists: async () => false,
      // Baum (v1.10.0): emptyTrash reparentet die Kinder jeder Notiz.
      updateMany: async () => ({ modifiedCount: 0 })
    }
  };
  const service = require(notesServicePath);

  const removed = await service.emptyTrash(USER);

  assert.equal(removed, 2);
  assert.equal(captured.findOneAndDelete.length, 2, 'eine bedingte Löschung pro gelesener Notiz');
  for (const filter of captured.findOneAndDelete) {
    assert.equal(filter.userId, USER);
    assert.deepEqual(filter.deletedAt, { $ne: null }, 'deleting by predicate alone could catch notes trashed in between');
  }
  assert.deepEqual(captured.findOneAndDelete.map((filter) => String(filter._id)).sort(), ['n1', 'n2']);
  assert.ok(deletedImages.length === 0);
});

test('admin statistics count the trash separately instead of hiding it in the total', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');

  assert.match(route, /Note\.countDocuments\(\{ deletedAt: null \}\)/);
  assert.match(route, /Note\.countDocuments\(\{ deletedAt: \{ \$ne: null \} \}\)/);
  assert.match(route, /\{ \$match: \{ deletedAt: null \} \},/, 'the per-user aggregation must skip the trash');
  assert.match(route, /trashNotes: trashCount/);

  // Die zweite, abweichende Implementierung (adminService.getStats) war toter
  // Code und kannte den Papierkorb ebenfalls nicht — sie ist weg.
  const service = fs.readFileSync(path.join(__dirname, '../services/adminService.js'), 'utf8');
  assert.doesNotMatch(service, /async function getStats/);
});

test('the admin console shows the trash number', () => {
  const adminConsole = fs.readFileSync(path.join(__dirname, '../../client/src/components/AdminConsole.jsx'), 'utf8');
  assert.match(adminConsole, /stats\.trashNotes/);
  assert.match(adminConsole, /t\('notesInTrash'\)/);

  for (const file of ['de.js', 'en.js']) {
    const translations = fs.readFileSync(path.join(__dirname, '../../client/src/translations', file), 'utf8');
    assert.match(translations, /notesInTrash:/, `${file} must translate the new stat`);
  }
});
