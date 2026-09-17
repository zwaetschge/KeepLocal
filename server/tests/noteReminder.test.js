const test = require('node:test');
const assert = require('node:assert/strict');

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

const USER_ID = 'user-1';
const ISO = '2026-10-01T09:30:00.000Z';

/** Note-Mock, der createNote-kompatibel ist (new Note(...) via Konstruktor). */
function makeCreateMock() {
  const saved = [];
  function NoteCtor(data) {
    this.data = data;
    this.save = async () => {
      saved.push(this.data);
      return { ...this.data };
    };
  }
  // nextTopOrder fragt nach der bisher hoechsten order des Abschnitts.
  NoteCtor.findOne = () => ({ sort: () => ({ select: async () => null }) });
  return { NoteCtor, saved };
}

/** Note-Mock fuer updateNote: findOne liefert den Server-Stand,
 *  findOneAndUpdate zeichnet $set auf. */
function makeUpdateMock() {
  const note = {
    title: 'Bestand',
    content: 'alt',
    isTodoList: false,
    todoItems: [],
    remindAt: null,
    updatedAt: new Date('2026-09-01T00:00:00.000Z')
  };
  let captured = null;
  return {
    note,
    getCaptured: () => captured,
    findOne: async () => note,
    findOneAndUpdate: async (_query, update) => {
      captured = update.$set;
      return { ...note, ...update.$set };
    }
  };
}

test('createNote speichert remindAt als Date', async () => {
  const { NoteCtor, saved } = makeCreateMock();
  const service = loadService(NoteCtor);

  await service.createNote({ content: 'mit Erinnerung', remindAt: ISO }, USER_ID);

  assert.equal(saved.length, 1);
  assert.ok(saved[0].remindAt instanceof Date, 'remindAt muss nach der Normalisierung ein Date sein');
  assert.equal(saved[0].remindAt.toISOString(), ISO);
});

test('createNote setzt remindAt null, wenn nichts geschickt wird', async () => {
  const { NoteCtor, saved } = makeCreateMock();
  const service = loadService(NoteCtor);

  await service.createNote({ content: 'ohne Erinnerung' }, USER_ID);

  assert.equal(saved[0].remindAt, null);
});

test('createNote und updateNote lehnen unparsebare remindAt-Werte mit 400 ab', async () => {
  const createMock = makeCreateMock();
  const createService = loadService(createMock.NoteCtor);
  await assert.rejects(
    () => createService.createNote({ content: 'x', remindAt: 'nicht-ein-datum' }, USER_ID),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    () => createService.createNote({ content: 'x', remindAt: 42 }, USER_ID),
    (error) => error.statusCode === 400
  );

  const updateMock = makeUpdateMock();
  const updateService = loadService(updateMock);
  await assert.rejects(
    () => updateService.updateNote('note-1', { remindAt: 'gleich-morgen' }, USER_ID),
    (error) => error.statusCode === 400
  );
});

test('updateNote setzt und loescht remindAt ueber $set', async () => {
  const mock = makeUpdateMock();
  const service = loadService(mock);

  await service.updateNote('note-1', { remindAt: ISO }, USER_ID);
  let captured = mock.getCaptured();
  assert.ok(captured.remindAt instanceof Date, 'gesetzte Erinnerung muss ein Date sein');
  assert.equal(captured.remindAt.toISOString(), ISO);

  await service.updateNote('note-1', { remindAt: null }, USER_ID);
  captured = mock.getCaptured();
  assert.equal(captured.remindAt, null, 'null muss die Erinnerung loeschen, nicht nur ignorieren');
});

test('updateNote laesst remindAt unberuehrt, wenn das Feld fehlt', async () => {
  const mock = makeUpdateMock();
  mock.note.remindAt = new Date(ISO);
  const service = loadService(mock);

  await service.updateNote('note-1', { title: 'nur der Titel' }, USER_ID);

  const captured = mock.getCaptured();
  assert.equal('remindAt' in captured, false, 'ohne Feld darf remindAt nicht im $set landen');
});

test('remindAt in der Vergangenheit ist erlaubt (Geraeteuhr, Import)', async () => {
  const mock = makeUpdateMock();
  const service = loadService(mock);
  const past = '2020-01-01T00:00:00.000Z';

  await service.updateNote('note-1', { remindAt: past }, USER_ID);
  assert.equal(mock.getCaptured().remindAt.toISOString(), past);
});
