const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// Improvement #3 (VERBESSERUNGEN_2026-09-11): every error response carries a
// stable machine-readable code, so clients can translate instead of showing the
// server's German prose. The codes are attached centrally (middleware) instead
// of editing ~80 call sites.

const errorCodeMiddleware = require('../middleware/errorCodes');
const errorHandler = require('../middleware/errorHandler');
const { MESSAGE_TO_CODE, STATUS_TO_CODE, ALL_CODES, codeForMessage } = require('../constants/errorCodes');

async function withApp(setup, run) {
  const app = express();
  app.use(errorCodeMiddleware);
  setup(app);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('a known error message gets its stable code', async () => {
  await withApp(
    app => app.get('/note', (req, res) => res.status(404).json({ error: 'Notiz nicht gefunden' })),
    async base => {
      const body = await (await fetch(`${base}/note`)).json();
      assert.equal(body.code, 'NOTE_NOT_FOUND');
      assert.equal(body.error, 'Notiz nicht gefunden', 'the prose stays for older clients');
    }
  );
});

test('an unknown message falls back to the status-derived code', async () => {
  await withApp(
    app => app.get('/odd', (req, res) => res.status(418).json({ error: 'Something nobody mapped' })),
    async base => {
      const body = await (await fetch(`${base}/odd`)).json();
      assert.equal(body.code, 'ERROR');
    }
  );

  await withApp(
    app => app.get('/teapot-mapped', (req, res) => res.status(429).json({ error: 'irrelevant' })),
    async base => {
      const body = await (await fetch(`${base}/teapot-mapped`)).json();
      assert.equal(body.code, 'RATE_LIMITED');
    }
  );
});

test('an explicit code at the call site always wins', async () => {
  await withApp(
    app => app.get('/explicit', (req, res) => res.status(401).json({ code: 'CURRENT_PASSWORD_INVALID', error: 'Aktuelles Passwort ist falsch' })),
    async base => {
      const body = await (await fetch(`${base}/explicit`)).json();
      assert.equal(body.code, 'CURRENT_PASSWORD_INVALID');
    }
  );
});

test('successful and non-error payloads are left alone', async () => {
  await withApp(
    app => {
      app.get('/ok', (req, res) => res.json({ notes: [], error: null }));
      app.get('/list', (req, res) => res.status(200).json([{ error: 'not a real error' }]));
      app.get('/ok-with-error-text', (req, res) => res.json({ error: 'Notiz nicht gefunden' }));
    },
    async base => {
      assert.deepEqual(await (await fetch(`${base}/ok`)).json(), { notes: [], error: null });
      assert.deepEqual(await (await fetch(`${base}/list`)).json(), [{ error: 'not a real error' }]);
      const untouched = await (await fetch(`${base}/ok-with-error-text`)).json();
      assert.equal(untouched.code, undefined, 'a 200 must not be labelled as an error');
    }
  );
});

// v1.16.0-Review: Ein geworfener Fehler mit eigenem Code (STORAGE_QUOTA_EXCEEDED
// aus dem ZIP-Import, EXPORT_BUSY, …) muss ihn DURCH den zentralen Handler
// retten — vorher verlor next(error) das Feld und der Status-Code gewann.
test('a thrown error keeps its own string code, numeric codes do not leak', async () => {
  await withApp(
    app => {
      app.get('/own-code', () => {
        const err = new Error('Eine voellig ungemappte Meldung');
        err.statusCode = 413;
        err.code = 'STORAGE_QUOTA_EXCEEDED';
        throw err;
      });
      app.get('/mongoose-dup', () => {
        const err = new Error('dup key');
        err.statusCode = 409;
        err.code = 11000; // mongoose duplicate-key: number, not a label
        throw err;
      });
      app.use(errorHandler);
    },
    async base => {
      const own = await (await fetch(`${base}/own-code`)).json();
      assert.equal(own.code, 'STORAGE_QUOTA_EXCEEDED', 'call-site code beats the status-derived fallback');

      const dup = await (await fetch(`${base}/mongoose-dup`)).json();
      assert.notEqual(dup.code, 11000, 'numeric mongoose codes must not appear as body.code');
      assert.equal(typeof dup.code, 'string');
    }
  );
});

test('errors thrown into the central handler are coded too', async () => {
  await withApp(
    app => {
      app.get('/boom', () => { throw new Error('kaputt'); });
      app.use(errorHandler);
    },
    async base => {
      const response = await fetch(`${base}/boom`);
      const body = await response.json();
      assert.equal(response.status, 500);
      assert.equal(body.code, 'INTERNAL_ERROR');
    }
  );
});

test('a mongoose VersionError is a 409 conflict, not a server error (Top-30 Nr. 12)', async () => {
  await withApp(
    app => {
      app.get('/race', () => {
        const error = new Error('No matching document found for id "507f…" version 3');
        error.name = 'VersionError';
        throw error;
      });
      app.use(errorHandler);
    },
    async base => {
      const response = await fetch(`${base}/race`);
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.error, 'Die Notiz wurde inzwischen geändert');
      assert.equal(body.code, 'NOTE_CONFLICT');
    }
  );

  await withApp(
    app => {
      app.get('/gone', () => {
        const error = new Error('Got doc null instead');
        error.name = 'DocumentNotFoundError';
        throw error;
      });
      app.use(errorHandler);
    },
    async base => {
      const response = await fetch(`${base}/gone`);
      assert.equal(response.status, 404);
    }
  );
});

test('the catalog is consistent', () => {
  assert.equal(new Set(ALL_CODES).size, ALL_CODES.length, 'ALL_CODES must be unique');
  for (const code of ALL_CODES) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/, `code is not UPPER_SNAKE: ${code}`);
  }
  for (const [message, code] of Object.entries(MESSAGE_TO_CODE)) {
    assert.ok(typeof message === 'string' && message.length > 3, `empty message for ${code}`);
    assert.ok(ALL_CODES.includes(code), `${code} missing from ALL_CODES`);
  }
  for (const code of Object.values(STATUS_TO_CODE)) {
    assert.ok(ALL_CODES.includes(code), `${code} missing from ALL_CODES`);
  }
});

test('codeForMessage prefers the message and falls back to the status', () => {
  assert.equal(codeForMessage('Bereits Freunde', 400), 'ALREADY_FRIENDS');
  assert.equal(codeForMessage('unbekannt', 403), 'FORBIDDEN');
  assert.equal(codeForMessage('unbekannt', 418), 'ERROR');
  assert.equal(codeForMessage(undefined, 404), 'NOT_FOUND');
});
