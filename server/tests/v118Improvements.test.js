const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// v1.18.0-Server-Änderungen: (a) Chunk-Idempotenz des Markdown-Imports — ein
// Retry nach Teil-Fehler duplizierte jede Notiz der bereits gelandeten Chunks;
// (b) Restore einer Revision mit baseUpdatedAt — der Restore lief als blindes
// updateNote und überschrieb still jede zwischenzeitliche Änderung, statt wie
// jeder PUT einen 409 anzubieten; (c) Transport-Fehler des AI-Dienstes als
// 503 mit stabilem Code statt 500.

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const importRunModelPath = require.resolve('../models/ImportRun');
const servicePath = require.resolve('../services/notesService');
const aiServicePath = require.resolve('../services/aiService');
const axiosPath = require.resolve('axios');

const OWNER_ID = '507f191e810c19729de860ea';
const NOTE_ID = '507f1f77bcf86cd799439011';
const IMPORT_ID = 'imp-20260924-0001';

function loadService(NoteMock, ImportRunMock) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: {} };
  require.cache[importRunModelPath] = { id: importRunModelPath, filename: importRunModelPath, loaded: true, exports: ImportRunMock };
  return require(servicePath);
}

/**
 * Minimal-Store für den Import-Pfad (Muster wie markdownImport.test.js):
 * find/countDocuments für Baum und Quota, findOne für nextTopOrder,
 * insertMany zeichnet every Batch auf.
 */
function makeStore(initial = []) {
  const docs = new Map(initial.map((note) => [String(note._id), { ...note }]));
  const inserted = [];

  const visible = () => [...docs.values()].filter((doc) =>
    String(doc.userId) === String(OWNER_ID) && doc.deletedAt == null);

  const NoteMock = {
    find: () => ({
      select() { return this; },
      sort() { return this; },
      lean: async () => visible().map((doc) => ({ _id: doc._id, parentId: doc.parentId ?? null, title: doc.title }))
    }),
    findOne: (query) => {
      if (String(query.userId) !== String(OWNER_ID)) return null;
      if (query.order === undefined || !query.order || query.order.$gt === undefined) return null;
      if (query.isPinned !== false || query.isArchived !== false) return null;
      const candidates = visible()
        .filter((doc) => doc.isPinned === false && doc.isArchived === false && typeof doc.order === 'number' && doc.order > 0)
        .sort((a, b) => b.order - a.order);
      const top = candidates[0];
      return {
        select() { return this; },
        sort() { return this; },
        lean() { return this; },
        then: (resolve) => resolve(top ? { order: top.order } : null)
      };
    },
    countDocuments: async () => visible().length,
    insertMany: async (batch) => {
      for (const doc of batch) {
        docs.set(String(doc._id), doc);
        inserted.push(doc);
      }
      return batch;
    }
  };
  return { docs, inserted, NoteMock };
}

/**
 * In-Memory-ImportRun: ein Zähler-Dokument pro (userId, importId). Emuliert die
 * Claim-Semantik (Review v1.18.0): updateOne mit $ne-Filter gewinnt genau
 * einmal (modifiedCount oder upsertedCount = 1), ein bereits vergebener Chunk
 * liefert 0/0 — und $pull gibt den Claim wieder frei.
 */
function makeImportRunStore() {
  const runs = new Map();
  const calls = { findOne: [], updateOne: [] };
  const key = (userId, importId) => `${String(userId)}:${importId}`;
  const ImportRunMock = {
    findOne: (query) => {
      calls.findOne.push(query);
      const run = runs.get(key(query.userId, query.importId));
      return { lean: async () => (run ? { appliedChunks: [...run] } : null) };
    },
    updateOne: async (filter, update) => {
      calls.updateOne.push({ filter, update });
      const k = key(filter.userId, filter.importId);
      const existing = runs.get(k);
      if (update.$pull) {
        existing?.delete(update.$pull.appliedChunks);
        return { upsertedId: null, modifiedCount: existing ? 1 : 0, upsertedCount: 0 };
      }
      const chunk = update.$addToSet.appliedChunks;
      if (existing && existing.has(chunk)) {
        return { upsertedId: null, modifiedCount: 0, upsertedCount: 0 };
      }
      if (!existing) {
        runs.set(k, new Set([chunk]));
        return { upsertedId: 'fresh', modifiedCount: 0, upsertedCount: 1 };
      }
      existing.add(chunk);
      return { upsertedId: null, modifiedCount: 1, upsertedCount: 0 };
    }
  };
  return {
    calls,
    ImportRunMock,
    appliedChunks: (importId) => [...(runs.get(`${OWNER_ID}:${importId}`) ?? [])].sort((a, b) => a - b)
  };
}

// ---------------------------------------------------------------------------
// Import-Idempotenz
// ---------------------------------------------------------------------------

test('an already applied import chunk is skipped instead of duplicated (v1.18.0)', async () => {
  const store = makeStore();
  const runStore = makeImportRunStore();
  const service = loadService(store.NoteMock, runStore.ImportRunMock);
  const items = [{ path: 'Projekte', title: 'Roadmap', content: '# Roadmap' }];

  const first = await service.importMarkdownNotes(OWNER_ID, items, { importId: IMPORT_ID, chunkIndex: 0 });
  assert.equal(first.created, 1);
  const insertedAfterFirst = store.inserted.length;

  const retry = await service.importMarkdownNotes(OWNER_ID, items, { importId: IMPORT_ID, chunkIndex: 0 });

  assert.deepEqual(
    { created: retry.created, foldersCreated: retry.foldersCreated, skipped: retry.skipped },
    { created: 0, foldersCreated: 0, skipped: true },
    'der Retry eines gelandeten Chunks legt nichts neu an'
  );
  assert.equal(store.inserted.length, insertedAfterFirst, 'keine zweite Notiz, kein zweiter Ordner');
  assert.deepEqual(
    runStore.calls.updateOne[0].filter,
    { userId: OWNER_ID, importId: IMPORT_ID, appliedChunks: { $ne: 0 } },
    'der Claim filtert atomar auf den noch freien Chunk'
  );
  assert.equal(runStore.calls.updateOne.length, 2, 'Claim des ersten Laufs + gescheiterter Claim des Retries');
  assert.deepEqual(runStore.appliedChunks(IMPORT_ID), [0]);
});

test('a different chunk of the same import run is applied normally', async () => {
  const store = makeStore();
  const runStore = makeImportRunStore();
  const service = loadService(store.NoteMock, runStore.ImportRunMock);

  const first = await service.importMarkdownNotes(
    OWNER_ID, [{ path: 'A', title: 'eins', content: 'x' }], { importId: IMPORT_ID, chunkIndex: 0 });
  const second = await service.importMarkdownNotes(
    OWNER_ID, [{ path: 'B', title: 'zwei', content: 'y' }], { importId: IMPORT_ID, chunkIndex: 1 });

  assert.equal(first.created, 1);
  assert.equal(second.created, 1);
  assert.equal(second.skipped, undefined, 'nur bereits angewandte Indizes werden übersprungen');
  assert.deepEqual(runStore.appliedChunks(IMPORT_ID), [0, 1], 'beide Indizes wandern in dasselbe Lauf-Dokument');
  assert.equal(runStore.calls.updateOne.length, 2);
});

test('a failed chunk releases its claim so the retry can apply it (Review v1.18.0)', async () => {
  const store = makeStore();
  const runStore = makeImportRunStore();
  const service = loadService(store.NoteMock, runStore.ImportRunMock);
  const items = [{ path: 'A', title: 'eins', content: 'x' }];

  const original = store.NoteMock.insertMany;
  store.NoteMock.insertMany = async () => { throw new Error('insert failed'); };
  await assert.rejects(
    service.importMarkdownNotes(OWNER_ID, items, { importId: IMPORT_ID, chunkIndex: 0 }),
    /insert failed/
  );

  const pullCall = runStore.calls.updateOne.find(call => call.update.$pull);
  assert.ok(pullCall, 'Fehlschlag nach Claim gibt ihn per $pull frei');
  assert.deepEqual(pullCall.filter, { userId: OWNER_ID, importId: IMPORT_ID });
  assert.deepEqual(pullCall.update.$pull, { appliedChunks: 0 });
  assert.deepEqual(runStore.appliedChunks(IMPORT_ID), [], 'kein Chunk bleibt gesperrt');

  store.NoteMock.insertMany = original;
  const retry = await service.importMarkdownNotes(OWNER_ID, items, { importId: IMPORT_ID, chunkIndex: 0 });
  assert.equal(retry.created, 1, 'der Retry läuft, weil der Claim freigegeben wurde');
  assert.equal(retry.skipped, undefined);
});

test('invalid import metadata is rejected before anything is written', async () => {
  const store = makeStore();
  const runStore = makeImportRunStore();
  const service = loadService(store.NoteMock, runStore.ImportRunMock);
  const items = [{ path: '', title: 'lose Notiz', content: 'x' }];

  for (const bad of [
    { importId: 'kurz', chunkIndex: 0 },          // zu kurz für das Muster
    { importId: 'hat ungültige Zeichen!', chunkIndex: 0 },
    { importId: IMPORT_ID },                       // chunkIndex fehlt
    { importId: IMPORT_ID, chunkIndex: -1 },
    { importId: IMPORT_ID, chunkIndex: 10000 },
    { importId: IMPORT_ID, chunkIndex: 'null' }
  ]) {
    await assert.rejects(
      service.importMarkdownNotes(OWNER_ID, items, bad),
      (error) => error.statusCode === 400,
      `importId=${JSON.stringify(bad.importId)} chunkIndex=${JSON.stringify(bad.chunkIndex)} muss 400 sein`
    );
  }
  assert.equal(store.inserted.length, 0);
  assert.equal(runStore.calls.updateOne.length, 0);
});

test('without importId the legacy path never touches ImportRun', async () => {
  const store = makeStore();
  const runStore = makeImportRunStore();
  const service = loadService(store.NoteMock, runStore.ImportRunMock);

  const result = await service.importMarkdownNotes(OWNER_ID, [{ path: '', title: 'solo', content: 'x' }]);

  assert.equal(result.created, 1);
  assert.equal(runStore.calls.findOne.length, 0, 'Einzel-Aufrufe bleiben vom Idempotenz-Pfad unberührt');
  assert.equal(runStore.calls.updateOne.length, 0);
});

test('the ImportRun model expires runs after six hours and stays unique per run', () => {
  const source = fs.readFileSync(path.join(__dirname, '../models/ImportRun.js'), 'utf8');

  assert.match(source, /expires: '6h'/, 'TTL begrenzt das Resume-Fenster');
  assert.match(source, /index\(\{ userId: 1, importId: 1 \}, \{ unique: true \}\)/, 'ein Zähler-Dokument pro Lauf');
  assert.match(source, /collection: 'import_runs'/);
});

test('the hot read paths are covered by indexes instead of document fetches (v1.18.0)', () => {
  // Die vier Zähler der Liste und die 60s-Sonde /meta filtern über $or(userId,
  // sharedWith) + deletedAt/isArchived und lesen updatedAt — ohne diese
  // Indizes war jede dieser Abfragen ein FETCH über die Volltext-Dokumente
  // des eigenen Korpus (content bis 10 KB, Revisionen inklusive), alle 60 s
  // pro offenem Tab.
  const source = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');

  assert.match(source, /noteSchema\.index\(\{ userId: 1, deletedAt: 1, isArchived: 1, updatedAt: -1 \}\)/,
    'Zähler, Sonde und Papierkorb-Sortierung über einen Präfix');
  assert.match(source, /noteSchema\.index\(\{ sharedWith: 1, deletedAt: 1, isArchived: 1, updatedAt: -1, userId: 1 \}\)/,
    'der $or-Zweig der geteilten Notizen zählt gedeckt mit (userId hinten: die '
    + '$group-Felder der Sonde, sonst FETCH je geteiltem Dokument)');
  assert.doesNotMatch(source, /noteSchema\.index\(\{ sharedWith: 1 \}\)/,
    'der Solo-Index ist ein strikter Präfix des Compound — nur Schreib-Last');
});

test('list sorts carry an _id tiebreaker so pages stay stable across pulls (v1.18.0)', () => {
  // Rest-Risiko aus dem (widerlegten) Delta-Pull-Finding: Bulk-Operationen
  // schreiben vielen Notizen denselben Zeitstempel. Ohne letzte Sortstufe
  // _id ist die Reihenfolge bei gleichem Schlüssel nichtdeterministisch —
  // Skip/Limit-Seiten + Delta-Pull können dann eine Änderung im Pull-Fenster
  // überspringen, obwohl jeder einzelne Cursor $gte (at-least-once) nutzt.
  const source = fs.readFileSync(path.join(__dirname, '../services/notesService.js'), 'utf8');

  assert.match(source, /: \{ isPinned: -1, order: -1, updatedAt: -1, createdAt: -1, _id: -1 \}\)/,
    'Live-Liste');
  assert.match(source, /\.sort\(\{ deletedAt: -1, _id: -1 \}\)/, 'Papierkorb (Bulk-Löschungen teilen deletedAt)');
  assert.match(source, /\.sort\(\{ isPinned: -1, order: -1, updatedAt: -1, _id: -1 \}\)/, 'Baum-Projektion');
  assert.match(source, /\.sort\(\{ updatedAt: -1, _id: -1 \}\)/, 'Backlinks (limit braucht stabile Ordnung)');
});

// ---------------------------------------------------------------------------
// Restore einer Revision mit baseUpdatedAt
// ---------------------------------------------------------------------------

const SAVED_AT = '2026-09-01T10:00:00.000Z';

function revisionModel({ liveUpdatedAt }) {
  // getNoteRevision ruft Note.findOne(...).select('revisions'), updateNote
  // await'et Note.findOne(...) direkt — ein Objekt mit beidem bedient beide.
  const revisionDoc = {
    _id: NOTE_ID, userId: OWNER_ID,
    revisions: [{
      savedAt: new Date(SAVED_AT), title: 'Alte Fassung', content: 'alter Inhalt',
      isTodoList: false, todoItems: []
    }]
  };
  const liveDoc = {
    _id: NOTE_ID, userId: OWNER_ID, title: 'Zwischenstand', content: 'neuerer Inhalt',
    isTodoList: false, todoItems: [], tags: [], color: '#ffffff', isPinned: false,
    isArchived: false, order: 4, parentId: null, images: [], files: [], linkPreviews: [],
    sharedWith: [], lastEditedBy: null, updatedAt: liveUpdatedAt
  };
  const writes = [];
  const NoteMock = {
    findOne: () => ({
      select: () => Promise.resolve(revisionDoc),
      then: (resolve, reject) => Promise.resolve(liveDoc).then(resolve, reject)
    }),
    findOneAndUpdate: async (query, update, options) => {
      writes.push({ query, update, options });
      return { ...liveDoc, ...update.$set };
    }
  };
  return { writes, NoteMock };
}

test('restoring a revision against a newer note base is a 409 (v1.18.0)', async () => {
  const model = revisionModel({ liveUpdatedAt: new Date() });
  const service = loadService(model.NoteMock, makeImportRunStore().ImportRunMock);

  const staleBase = new Date(Date.now() - 60_000).toISOString();
  await assert.rejects(
    service.restoreNoteRevision(NOTE_ID, OWNER_ID, SAVED_AT, staleBase),
    (error) => {
      assert.equal(error.statusCode, 409, 'wie jeder PUT-Konflikt');
      assert.ok(error.currentNote, 'currentNote reist mit, damit der Client neu laden kann');
      return true;
    }
  );
  assert.equal(model.writes.length, 0, 'Konflikt darf nicht schreiben');
});

test('restoring without a conflicting base writes the revision content through', async () => {
  const model = revisionModel({ liveUpdatedAt: new Date() });
  const service = loadService(model.NoteMock, makeImportRunStore().ImportRunMock);

  // Ohne baseUpdatedAt (alter Client): kein Konflikt möglich — der Restore
  // fällt wie bisher in das bedingte updateNote.
  const note = await service.restoreNoteRevision(NOTE_ID, OWNER_ID, SAVED_AT, undefined);

  assert.equal(model.writes.length, 1);
  assert.equal(model.writes[0].update.$set.title, 'Alte Fassung');
  assert.equal(note.title, 'Alte Fassung');
});

// ---------------------------------------------------------------------------
// AI-Dienst ohne Container: 503 statt 500
// ---------------------------------------------------------------------------

test('a dead AI container surfaces as 503 with a stable code (v1.18.0)', async () => {
  // ECONNABORTED ist der importantere der beiden: axios meldet einen über
  // `timeout:` abgelaufenen Request (Container up, aber im Model-Load
  // hängend) genau so — ECONNREFUSED nur den toten Port (Review v1.18.0).
  for (const axiosCode of ['ECONNREFUSED', 'ECONNABORTED']) {
  const original = require.cache[axiosPath];
  require.cache[axiosPath] = {
    id: axiosPath, filename: axiosPath, loaded: true,
    exports: {
      post: async () => {
        const error = new Error(axiosCode === 'ECONNREFUSED'
          ? 'connect ECONNREFUSED 127.0.0.1:5000' : 'timeout of 300000ms exceeded');
        error.code = axiosCode;
        throw error;
      }
    }
  };
  fs.writeFileSync('/tmp/ai-down-probe.wav', 'x');
  try {
    delete require.cache[aiServicePath];
    const aiService = require(aiServicePath);

    await assert.rejects(
      aiService.transcribeAudio('/tmp/ai-down-probe.wav', 'de', 'req-503'),
      (error) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'AI_SERVICE_UNAVAILABLE');
        assert.match(error.message, /nicht erreichbar/);
        return true;
      }
    );
  } finally {
    if (original) require.cache[axiosPath] = original;
    else delete require.cache[axiosPath];
    delete require.cache[aiServicePath];
    fs.rmSync('/tmp/ai-down-probe.wav', { force: true });
  }
  }
});
