const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// BUG_REPORT_2026-09-10 (Runde 3) #7: 'auto' is the value the app stores for
// "detect automatically". The transcription route used to reject it with 400
// "Ungueltiger Sprachcode", so every client except the browser bundle (which
// filters 'auto' itself) broke on the default setting.

const servicePath = require.resolve('../services/notesService');
const aiPath = require.resolve('../services/aiService');
const authPath = require.resolve('../middleware/auth');
const uploadPath = require.resolve('../middleware/upload');
const magicPath = require.resolve('../utils/magicNumberValidator');
const routerPath = require.resolve('../routes/notes');

function loadRouter(captured) {
  for (const p of [routerPath, servicePath, aiPath, authPath, uploadPath, magicPath]) delete require.cache[p];

  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true,
    exports: { getOwnedNoteById: async () => ({ _id: 'note-id', userId: 'user-id', images: [] }) }
  };
  require.cache[aiPath] = {
    id: aiPath, filename: aiPath, loaded: true,
    exports: {
      transcribeAudio: async (_path, language) => {
        captured.language = language;
        return { text: 'hallo welt', language: 'de', probability: 0.9 };
      }
    }
  };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => { req.user = { _id: 'user-id', isDemo: false }; next(); }
    }
  };
  require.cache[uploadPath] = {
    id: uploadPath, filename: uploadPath, loaded: true,
    exports: {
      upload: { array: () => (req, _res, next) => next() },
      uploadAudio: {
        // Real multer fills req.body with the multipart text fields; the mock
        // takes them from a test header instead.
        single: () => (req, _res, next) => {
          req.file = { path: '/tmp/does-not-exist-audit.wav' };
          try {
            req.body = JSON.parse(req.headers['x-test-fields'] || '{}');
          } catch {
            req.body = {};
          }
          next();
        }
      },
      isSafeStoredFilename: () => true
    }
  };
  require.cache[magicPath] = {
    id: magicPath, filename: magicPath, loaded: true,
    exports: { validateAudioFile: async () => true, validateImageFile: async () => true }
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
    for (const p of [routerPath, servicePath, aiPath, authPath, uploadPath, magicPath]) delete require.cache[p];
  }
}

async function postTranscription(base, language) {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('RIFF....WAVE')], { type: 'audio/wav' }), 'recording.wav');
  if (language !== undefined) form.append('language', language);
  const response = await fetch(`${base}/507f1f77bcf86cd799439011/transcribe`, {
    method: 'POST',
    body: form,
    headers: { 'x-test-fields': JSON.stringify(language === undefined ? {} : { language }) }
  });
  return { status: response.status, body: await response.json() };
}

test("language 'auto' is accepted and forwarded as no hint", async () => {
  const captured = {};
  await withServer(loadRouter(captured), async base => {
    const { status, body } = await postTranscription(base, 'auto');

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.text, 'hallo welt');
    assert.equal(captured.language, null, "'auto' must not reach the AI service as a language hint");
  });
});

test('an explicit language code is forwarded unchanged', async () => {
  const captured = {};
  await withServer(loadRouter(captured), async base => {
    const { status } = await postTranscription(base, 'de');
    assert.equal(status, 200);
    assert.equal(captured.language, 'de');
  });
});

test('a missing language stays null', async () => {
  const captured = { language: 'unset' };
  await withServer(loadRouter(captured), async base => {
    const { status } = await postTranscription(base);
    assert.equal(status, 200);
    assert.equal(captured.language, null);
  });
});

test('an invalid language code is still rejected with 400', async () => {
  const captured = {};
  await withServer(loadRouter(captured), async base => {
    const { status, body } = await postTranscription(base, '../../etc');
    assert.equal(status, 400);
    assert.match(body.error, /Sprachcode/);
    assert.equal(captured.language, undefined, 'the AI service must not be called');
  });
});
