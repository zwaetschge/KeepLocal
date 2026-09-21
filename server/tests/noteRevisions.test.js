const test = require('node:test');
const assert = require('node:assert/strict');

// v1.13.0 Nr. 5 — Notiz-Historie: updateNote überschrieb content/title/todoItems
// ohne Snapshot; bei einem 409-Konflikt erzeugt Android dauerhafte
// „(lokale Version …)"-Duplikate. Jetzt: gecapptes revisions[], atomar mit dem
// Edit geschrieben, Restore über den savedAt-Schlüssel (nie Array-Index).

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

const USER = '507f191e810c19729de86011';
const EDITOR = '507f191e810c19729de86022';

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

function storedDoc(overrides = {}) {
  return {
    _id: 'n1',
    userId: USER,
    title: 'Alte Fassung',
    content: 'Alter Inhalt',
    isTodoList: false,
    todoItems: [],
    tags: [],
    linkPreviews: [],
    lastEditedBy: EDITOR,
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    revisions: [],
    ...overrides
  };
}

/** findOne/findOneAndUpdate-Mock: .select()/.populate() kettenbar, await liefert das Doc. */
function revisionMock(doc, { updates = [] } = {}) {
  const thenable = (d) => ({
    select() { return this; },
    populate() { return this; },
    then: (resolve, reject) => Promise.resolve(d).then(resolve, reject)
  });
  return {
    updates,
    findOne: () => thenable(doc),
    findOneAndUpdate: (query, update, options) => {
      updates.push({ query, update, options });
      return thenable({ ...doc, ...(update.$set || {}) });
    }
  };
}

test('updateNote snapshotts die überschriebene Fassung atomar mit dem Edit', async () => {
  const model = revisionMock(storedDoc());
  const service = loadService(model);

  await service.updateNote('n1', { content: 'Neuer Inhalt' }, USER);

  assert.equal(model.updates.length, 1);
  const push = model.updates[0].update.$push;
  assert.ok(push, 'der Snapshot reist in derselben findOneAndUpdate mit');
  assert.equal(push.revisions.$each.length, 1);
  assert.equal(push.revisions.$each[0].content, 'Alter Inhalt', 'gesnapshottet wird die VORHERIGE Fassung');
  assert.equal(push.revisions.$each[0].title, 'Alte Fassung');
  assert.equal(String(push.revisions.$each[0].editorId), EDITOR);
  assert.equal(push.revisions.$slice, -10, 'gecappt auf 10 Fassungen');
  assert.equal(model.updates[0].update.$set.content, 'Neuer Inhalt');
});

test('ein identischer Re-Save verbraucht keinen Revisions-Slot', async () => {
  const model = revisionMock(storedDoc({ content: 'gleich bleibt' }));
  const service = loadService(model);

  await service.updateNote('n1', { content: 'gleich bleibt' }, USER);
  assert.equal(model.updates[0].update.$push, undefined, 'kein Snapshot ohne echte Änderung');

  model.updates.length = 0;
  await service.updateNote('n1', { color: '#aecbfa' }, USER);
  assert.equal(model.updates[0].update.$push, undefined, 'Farbe/Pin/Tags sind keine Inhaltsänderung');
});

test('getNoteRevisions liefert Metadaten ohne Volltexte, neueste zuerst', async () => {
  const savedAtOld = new Date('2026-09-01T10:00:00.000Z');
  const savedAtNew = new Date('2026-09-02T10:00:00.000Z');
  const model = revisionMock(storedDoc({
    revisions: [
      { title: 'Fassung A', content: 'x'.repeat(500), isTodoList: false, todoItems: [], savedAt: savedAtOld, editorId: EDITOR },
      { title: 'Fassung B', content: 'y'.repeat(200), isTodoList: true, todoItems: [{ text: 't', completed: false, order: 0 }], savedAt: savedAtNew, editorId: null }
    ]
  }));
  const service = loadService(model);

  const revisions = await service.getNoteRevisions('n1', USER);
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].title, 'Fassung B', 'neueste zuerst');
  assert.equal(revisions[0].todoCount, 1);
  assert.equal(revisions[0].contentLength, 200);
  assert.equal('content' in revisions[0], false, 'Volltexte reisen nicht in der Liste');
  assert.equal('todoItems' in revisions[0], false);
});

test('Volltext einer Fassung per savedAt, falscher Zeitpunkt ist 404', async () => {
  const savedAt = new Date('2026-09-01T10:00:00.000Z');
  const model = revisionMock(storedDoc({
    revisions: [{ title: 'Fassung A', content: 'Volltext', isTodoList: false, todoItems: [], savedAt, editorId: EDITOR }]
  }));
  const service = loadService(model);

  const revision = await service.getNoteRevision('n1', USER, savedAt.toISOString());
  assert.equal(revision.content, 'Volltext');

  const missing = await service.getNoteRevision('n1', USER, '2020-01-01T00:00:00.000Z').catch((error) => error);
  assert.equal(missing.statusCode, 404);
});

test('Restore läuft als normales updateNote — der aktuelle Stand wird selbst Revision', async () => {
  const savedAt = new Date('2026-09-01T10:00:00.000Z');
  const doc = storedDoc({
    title: 'Aktuell',
    content: 'Aktueller Inhalt',
    revisions: [{ title: 'Alte Fassung', content: 'Alter Volltext', isTodoList: false, todoItems: [], savedAt, editorId: EDITOR }]
  });
  const model = revisionMock(doc);
  const service = loadService(model);

  const restored = await service.restoreNoteRevision('n1', USER, savedAt.toISOString());

  assert.equal(restored.content, 'Alter Volltext');
  const push = model.updates[0].update.$push;
  assert.ok(push, 'der Restore-Schreibvorgang snapshottet die überschriebene Fassung');
  assert.equal(push.revisions.$each[0].content, 'Aktueller Inhalt');
  assert.equal(push.revisions.$each[0].title, 'Aktuell');
});

test('die Route meldet Revisionen vor /:id und validiert den Restore-Body', () => {
  const fs = require('node:fs');
  const routes = fs.readFileSync(require.resolve('../routes/notes.js'), 'utf8');
  const revisionsAt = routes.indexOf("router.get('/:id/revisions'");
  const singleAt = routes.indexOf("router.get('/:id'");
  assert.ok(revisionsAt > -1 && revisionsAt < singleAt, '/revisions muss vor /:id registriert sein');
  assert.match(routes, /router\.post\('\/:id\/revisions\/restore'/);
  assert.match(routes, /at \(ISO-Zeitpunkt der Fassung\) ist erforderlich/);
  assert.match(routes, /rejectDemoNoteCapabilities, noteValidation\.getOne, async \(req, res, next\) => \{\s*\n\s*try \{\s*\n\s*if \(!req\.body \|\| typeof req\.body\.at !== 'string'/);

  const model = fs.readFileSync(require.resolve('../models/Note.js'), 'utf8');
  assert.match(model, /revisions: \[\{/);
  assert.match(model, /savedAt: \{ type: Date, required: true \}/);
});
