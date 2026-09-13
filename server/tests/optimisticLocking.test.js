const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// Keep a reference to the real mongoose model before loadService() replaces
// the module in the require cache. It serializes exactly like a saved note
// without needing a database connection.
const RealNote = require('../models/Note');

const noteModelPath = require.resolve('../models/Note');
const userModelPath = require.resolve('../models/User');
const servicePath = require.resolve('../services/notesService');
const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/notes');

const NOTE_ID = '507f1f77bcf86cd799439011';
const STORED_AT = '2026-09-06T10:00:00.000Z';

function loadService(NoteMock, UserMock = {}) {
  delete require.cache[servicePath];
  require.cache[noteModelPath] = { id: noteModelPath, filename: noteModelPath, loaded: true, exports: NoteMock };
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  return require(servicePath);
}

function buildStoredNote(overrides = {}) {
  return {
    title: 'Server-Stand',
    content: 'Neuerer Inhalt',
    color: '#ffffff',
    isPinned: false,
    tags: [],
    isTodoList: false,
    todoItems: [],
    linkPreviews: [],
    updatedAt: new Date(STORED_AT),
    ...overrides
  };
}

/**
 * Note-Modell-Mock für den bedingten Schreibpfad: updateNote liest zuerst per
 * findOne, schreibt dann per findOneAndUpdate mit updatedAt-Precondition. Geht
 * der Schreib-Lauf ins Leere (writeResult null), liest der Service ein zweites
 * Mal — mockReadable steuert, was dieser Re-Read sieht.
 */
function noteModelMock({
  stored = buildStoredNote(),
  writeResult,
  onReread = 'stored',
  writes = []
} = {}) {
  let reads = 0;
  return {
    writes,
    findOne: async (query) => {
      reads += 1;
      return reads === 1 ? stored : (onReread === 'stored' ? stored : onReread);
    },
    findOneAndUpdate: async (query, update, options) => {
      writes.push({ query, update, options });
      // Default: der Schreib-Lauf trifft und gibt den aktualisierten Stand zurück.
      return writeResult === undefined ? { ...stored, ...update.$set } : writeResult;
    }
  };
}

// ---------------------------------------------------------------------------
// Service-level tests (mocked Note model, same pattern as notesService.test.js)
// ---------------------------------------------------------------------------

test('update without baseUpdatedAt skips the staleness pre-check (legacy clients keep working)', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  const result = await service.updateNote(NOTE_ID, { content: 'Client-Version' }, 'user-id');

  assert.equal(result.content, 'Client-Version');
  assert.equal(model.writes.length, 1);
  // Auch ohne Client-Precondition schützt der Server das Rennen: geschrieben
  // wird nur, wenn zwischen Lesen und Schreiben niemand anders gewonnen hat.
  assert.equal(
    new Date(model.writes[0].query.updatedAt).toISOString(),
    STORED_AT
  );
});

test('update succeeds when baseUpdatedAt matches the stored updatedAt', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  const result = await service.updateNote(
    NOTE_ID,
    { content: 'Client-Version', baseUpdatedAt: STORED_AT },
    'user-id'
  );

  assert.equal(result.content, 'Client-Version');
  assert.equal(model.writes.length, 1);
});

test('the full 1s tolerance window counts as current', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  // Exactly 1000ms stale must NOT conflict (only differences > 1s do).
  await service.updateNote(
    NOTE_ID,
    { content: 'Client-Version', baseUpdatedAt: '2026-09-06T09:59:59.000Z' },
    'user-id'
  );

  assert.equal(model.writes.length, 1);
});

test('the conditional write carries the version token, access filter and lastEditedBy', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  await service.updateNote(
    NOTE_ID,
    { content: 'Client-Version', baseUpdatedAt: STORED_AT },
    'user-id'
  );

  const { query, update, options } = model.writes[0];
  assert.equal(
    new Date(query.updatedAt).toISOString(),
    STORED_AT,
    'the updatedAt read from the document is the write precondition'
  );
  assert.equal(query._id, NOTE_ID);
  assert.equal(query.deletedAt, null);
  assert.deepEqual(query.$or, [{ userId: 'user-id' }, { sharedWith: 'user-id' }]);
  assert.equal(options.new, true);
  assert.equal(update.$set.content, 'Client-Version');
  assert.equal(update.$set.lastEditedBy, 'user-id');
});

test('a stale baseUpdatedAt fails with 409, the stored note, and no write', async () => {
  const note = buildStoredNote();
  const model = noteModelMock({ stored: note });
  const service = loadService(model);

  await assert.rejects(
    service.updateNote(
      NOTE_ID,
      { content: 'Veraltete Client-Version', baseUpdatedAt: '2026-09-06T09:59:58.000Z' },
      'user-id'
    ),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, 'Die Notiz wurde inzwischen geändert');
      // currentNote reflects the server state, not the rejected edit.
      assert.equal(error.currentNote, note);
      assert.equal(error.currentNote.title, 'Server-Stand');
      assert.equal(error.currentNote.content, 'Neuerer Inhalt');
      assert.equal(
        new Date(error.currentNote.updatedAt).toISOString(),
        STORED_AT
      );
      return true;
    }
  );

  assert.equal(model.writes.length, 0);
});

test('the conflict boundary is exclusive: more than 1000ms difference is rejected', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  await assert.rejects(
    service.updateNote(
      NOTE_ID,
      { content: 'x', baseUpdatedAt: '2026-09-06T09:59:58.999Z' }, // 1001ms stale
      'user-id'
    ),
    error => error.statusCode === 409
  );
  assert.equal(model.writes.length, 0);
});

test('invalid baseUpdatedAt values are ignored like a missing value', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  for (const baseUpdatedAt of ['not-a-date', '', '   ', 12345, { iso: STORED_AT }, null]) {
    await service.updateNote(NOTE_ID, { content: 'Client-Version', baseUpdatedAt }, 'user-id');
  }

  assert.equal(model.writes.length, 6);
  assert.equal(model.writes[5].update.$set.content, 'Client-Version');
});

test('baseUpdatedAt is never written onto the persisted note document', async () => {
  const model = noteModelMock();
  const service = loadService(model);

  await service.updateNote(
    NOTE_ID,
    {
      title: 'Neuer Titel',
      content: 'Neuer Inhalt',
      baseUpdatedAt: STORED_AT,
      rogueField: 'sollte ebenfalls nicht persistiert werden'
    },
    'user-id'
  );

  assert.equal('baseUpdatedAt' in model.writes[0].update.$set, false);
  assert.equal('rogueField' in model.writes[0].update.$set, false);
  assert.equal(model.writes[0].update.$set.title, 'Neuer Titel');
  assert.equal(model.writes[0].update.$set.content, 'Neuer Inhalt');
});

test('a lost write race becomes 409 with the fresh server note, not a 500', async () => {
  // Zwischen Lesen und Schreiben gewinnt ein zweiter Schreibender: Der
  // bedingte Update verfehlt (null), der Re-Read liefert den Sieger-Stand.
  const winner = buildStoredNote({
    title: 'Gewinner-Stand',
    content: 'Zweiter Schreiber war schneller',
    updatedAt: new Date('2026-09-06T10:00:02.000Z')
  });
  const model = noteModelMock({ writeResult: null, onReread: winner });
  const service = loadService(model);

  await assert.rejects(
    service.updateNote(NOTE_ID, { content: 'Zu langsam' }, 'user-id'),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.currentNote, winner);
      assert.equal(error.currentNote.title, 'Gewinner-Stand');
      return true;
    }
  );
});

test('a lost write race where the note vanished becomes 404', async () => {
  const model = noteModelMock({ writeResult: null, onReread: null });
  const service = loadService(model);

  await assert.rejects(
    service.updateNote(NOTE_ID, { content: 'Zu langsam' }, 'user-id'),
    error => {
      assert.equal(error.statusCode, 404);
      return true;
    }
  );
});

test('pin toggle is one atomic pipeline update — no read-modify-write, no save', async () => {
  const writes = [];
  const reads = [];
  const service = loadService({
    findOne: async (query) => { reads.push(query); return buildStoredNote(); },
    findOneAndUpdate: async (query, update, options) => {
      writes.push({ query, update, options });
      return buildStoredNote({ isPinned: true });
    }
  });

  const note = await service.togglePinNote(NOTE_ID, 'user-id');

  assert.equal(reads.length, 0, 'the toggle must not read first');
  assert.equal(writes.length, 1);
  assert.ok(Array.isArray(writes[0].update), 'the toggle must be a pipeline update');
  assert.deepEqual(
    writes[0].update[0].$set.isPinned,
    { $not: ['$isPinned'] },
    'the flip happens inside the database, atomically'
  );
  assert.equal(writes[0].options.new, true);
  assert.equal(note.isPinned, true);
});

test('pin toggle of a missing note stays 404', async () => {
  const service = loadService({
    findOneAndUpdate: async () => null
  });

  await assert.rejects(
    service.togglePinNote(NOTE_ID, 'user-id'),
    error => error.statusCode === 404
  );
});

test('archive toggle flips atomically and stays owner-only', async () => {
  const writes = [];
  const service = loadService({
    findOneAndUpdate: async (query, update, options) => {
      writes.push({ query, update, options });
      return buildStoredNote({ isArchived: true });
    }
  });

  const note = await service.toggleArchiveNote(NOTE_ID, 'user-id');

  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].query,
    { _id: NOTE_ID, userId: 'user-id', deletedAt: null }
  );
  assert.deepEqual(
    writes[0].update[0].$set.isArchived,
    { $not: ['$isArchived'] }
  );
  assert.equal(note.isArchived, true);
});

test('the conflict currentNote serializes like a regular PUT response with ISO dates', async () => {
  const storedNote = new RealNote({
    title: 'Server-Stand',
    content: 'Neuerer Inhalt',
    userId: NOTE_ID
  });
  storedNote.updatedAt = new Date(STORED_AT);

  const service = loadService({ findOne: async () => storedNote });

  let conflictError;
  try {
    await service.updateNote(
      NOTE_ID,
      { content: 'Veraltete Client-Version', baseUpdatedAt: '2026-09-06T08:00:00.000Z' },
      'user-id'
    );
    assert.fail('stale baseUpdatedAt must conflict');
  } catch (error) {
    conflictError = error;
  }

  assert.equal(conflictError.statusCode, 409);

  // res.json() uses JSON.stringify, which routes through the mongoose
  // toJSON transform — the same path a successful PUT response takes.
  const payload = JSON.parse(JSON.stringify({
    error: conflictError.message,
    currentNote: conflictError.currentNote
  }));

  assert.equal(payload.error, 'Die Notiz wurde inzwischen geändert');
  assert.equal(payload.currentNote.title, 'Server-Stand');
  assert.equal(payload.currentNote.content, 'Neuerer Inhalt');
  assert.equal(payload.currentNote.updatedAt, STORED_AT);
  assert.equal('baseUpdatedAt' in payload.currentNote, false);
});

// ---------------------------------------------------------------------------
// HTTP-level tests (real router + real validators, service mocked)
// ---------------------------------------------------------------------------

function loadRouterWithMocks(serviceMock, authMock) {
  delete require.cache[routerPath];
  delete require.cache[servicePath];
  delete require.cache[authPath];
  require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true, exports: serviceMock };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authMock };
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
    delete require.cache[routerPath];
    delete require.cache[servicePath];
    delete require.cache[authPath];
  }
}

async function putNote(base, payload) {
  const response = await fetch(`${base}/${NOTE_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

function authStub() {
  return {
    authenticateToken: (req, res, next) => {
      req.user = { _id: 'user-id', isDemo: false };
      next();
    }
  };
}

test('HTTP PUT without baseUpdatedAt responds 200 like before', async () => {
  const updatedNote = { _id: NOTE_ID, title: 'Server-Stand', content: 'Gespeichert' };
  const serviceMock = {
    updateNote: async (noteId, noteData, userId) => {
      assert.equal(noteId, NOTE_ID);
      assert.equal(userId, 'user-id');
      assert.equal('baseUpdatedAt' in noteData, false);
      return updatedNote;
    }
  };

  await withServer(loadRouterWithMocks(serviceMock, authStub()), async base => {
    const { status, body } = await putNote(base, { title: 'Server-Stand', content: 'Gespeichert' });

    assert.equal(status, 200);
    assert.deepEqual(body, updatedNote);
  });
});

test('HTTP PUT forwards baseUpdatedAt through the validator to the service unchanged', async () => {
  let receivedBody;
  const serviceMock = {
    updateNote: async (noteId, noteData) => {
      receivedBody = noteData;
      return { _id: NOTE_ID, content: noteData.content };
    }
  };

  await withServer(loadRouterWithMocks(serviceMock, authStub()), async base => {
    const { status } = await putNote(base, {
      content: 'Client-Version',
      baseUpdatedAt: STORED_AT
    });

    assert.equal(status, 200);
    assert.equal(receivedBody.baseUpdatedAt, STORED_AT);
  });
});

test('HTTP PUT conflict responds 409 with error message and currentNote', async () => {
  const currentNote = {
    _id: NOTE_ID,
    title: 'Server-Stand',
    content: 'Neuerer Inhalt',
    updatedAt: STORED_AT
  };
  const conflict = new Error('Die Notiz wurde inzwischen geändert');
  conflict.statusCode = 409;
  conflict.currentNote = currentNote;
  const serviceMock = {
    updateNote: async () => { throw conflict; }
  };

  await withServer(loadRouterWithMocks(serviceMock, authStub()), async base => {
    const { status, body } = await putNote(base, {
      content: 'Veraltete Client-Version',
      baseUpdatedAt: '2026-09-06T08:00:00.000Z'
    });

    assert.equal(status, 409);
    assert.equal(body.error, 'Die Notiz wurde inzwischen geändert');
    assert.deepEqual(body.currentNote, currentNote);
  });
});

test('HTTP PUT with an invalid baseUpdatedAt format is not rejected with 400', async () => {
  let receivedBody;
  const serviceMock = {
    updateNote: async (noteId, noteData) => {
      receivedBody = noteData;
      return { _id: NOTE_ID, content: noteData.content };
    }
  };

  await withServer(loadRouterWithMocks(serviceMock, authStub()), async base => {
    const { status, body } = await putNote(base, {
      content: 'Client-Version',
      baseUpdatedAt: 'not-a-date'
    });

    assert.equal(status, 200);
    assert.equal(body.content, 'Client-Version');
    assert.equal(receivedBody.baseUpdatedAt, 'not-a-date');
  });
});

test('a subsequent GET of the updated note exposes no baseUpdatedAt field', async () => {
  const storedNote = {
    _id: NOTE_ID,
    title: 'Server-Stand',
    content: 'Gespeicherter Inhalt',
    updatedAt: STORED_AT
  };
  const serviceMock = {
    updateNote: async () => storedNote,
    getNoteById: async () => storedNote
  };

  await withServer(loadRouterWithMocks(serviceMock, authStub()), async base => {
    const putResult = await putNote(base, {
      content: 'Gespeicherter Inhalt',
      baseUpdatedAt: STORED_AT
    });
    assert.equal(putResult.status, 200);
    assert.equal('baseUpdatedAt' in putResult.body, false);

    const response = await fetch(`${base}/${NOTE_ID}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal('baseUpdatedAt' in body, false);
    assert.equal(body.updatedAt, STORED_AT);
  });
});
