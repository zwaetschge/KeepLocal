process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const cookieParser = require('cookie-parser');

// Improvement #7: expensive endpoints need their own budgets. The global limiter
// (500 requests/15 min per IP) neither protects the single Whisper worker nor the
// outbound traffic of link previews, and behind a reverse proxy everybody shares
// one IP — so these limits are per user.

const servicePath = require.resolve('../services/notesService');
const aiPath = require.resolve('../services/aiService');
const previewPath = require.resolve('../services/linkPreviewService');
const authPath = require.resolve('../middleware/auth');
const uploadPath = require.resolve('../middleware/upload');
const magicPath = require.resolve('../utils/magicNumberValidator');
const routerPath = require.resolve('../routes/notes');

const NOTE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';

function loadRouter({ getLinkPreview, transcribeAudio }) {
  for (const p of [routerPath, servicePath, aiPath, previewPath, authPath, uploadPath, magicPath]) {
    delete require.cache[p];
  }
  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true,
    exports: { getEditableNoteById: async () => ({ _id: NOTE_ID, userId: USER_ID, images: [] }) }
  };
  require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: { transcribeAudio } };
  require.cache[previewPath] = {
    id: previewPath, filename: previewPath, loaded: true,
    exports: { getLinkPreview }
  };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: { authenticateToken: (req, _res, next) => { req.user = { _id: USER_ID, isDemo: false }; next(); } }
  };
  require.cache[uploadPath] = {
    id: uploadPath, filename: uploadPath, loaded: true,
    exports: {
      upload: { array: () => (req, _res, next) => next() },
      uploadAudio: {
        single: () => (req, _res, next) => {
          req.file = { path: '/tmp/e2e-audit-audio.wav' };
          req.body = {};
          next();
        }
      },
      // v1.15.0: Multer-Instanzen sind route-level Middleware (load-time
      // .array/.single im Router-Modul) — der Stub braucht alle vier.
      uploadPdf: { array: () => (req, _res, next) => next() },
      uploadZip: { single: () => (req, _res, next) => next() },
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
  app.use(cookieParser());
  app.use('/api/notes', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/notes`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [routerPath, servicePath, aiPath, previewPath, authPath, uploadPath, magicPath]) {
      delete require.cache[p];
    }
  }
}

const postPreview = (base, url = 'https://example.com/') => fetch(`${base}/link-preview`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url })
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('link previews are limited per user with a retry hint', async () => {
  process.env.LINK_PREVIEW_LIMIT_PER_MINUTE = '2';
  const calls = [];
  const router = loadRouter({
    getLinkPreview: async (url) => { calls.push(url); return { preview: { url, title: 'x' }, cached: false }; }
  });

  try {
    await withServer(router, async base => {
      const first = await postPreview(base, 'https://example.com/1');
      const second = await postPreview(base, 'https://example.com/2');
      const third = await postPreview(base, 'https://example.com/3');

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429, 'the third preview within a minute must be refused');

      const body = await third.json();
      assert.equal(body.code, 'LINK_PREVIEW_RATE_LIMITED');
      assert.equal(third.headers.get('retry-after'), '60');
      assert.equal(calls.length, 2, 'a refused request must not reach the network');
      assert.ok(second.headers.get('ratelimit-limit'), 'standard rate limit headers are sent');
    });
  } finally {
    delete process.env.LINK_PREVIEW_LIMIT_PER_MINUTE;
  }
});

test('the preview cache header reports hits and misses', async () => {
  const router = loadRouter({
    getLinkPreview: async (url) => ({ preview: { url, title: 'x' }, cached: url.includes('cached') })
  });

  await withServer(router, async base => {
    const miss = await postPreview(base, 'https://example.com/miss');
    assert.equal(miss.headers.get('x-preview-cache'), 'miss');
    const hit = await postPreview(base, 'https://example.com/cached');
    assert.equal(hit.headers.get('x-preview-cache'), 'hit');
  });
});

test('transcriptions are gated by concurrency, not queued into timeouts', async () => {
  process.env.MAX_CONCURRENT_TRANSCRIPTIONS = '1';
  const gate = deferred();
  let started = 0;
  const router = loadRouter({
    transcribeAudio: async () => {
      started += 1;
      await gate.promise;
      return { text: 'hallo', language: 'de', probability: 0.9 };
    }
  });

  try {
    await withServer(router, async base => {
      const first = fetch(`${base}/${NOTE_ID}/transcribe`, { method: 'POST' });
      // Wait until the first request holds the gate.
      for (let i = 0; i < 50 && started === 0; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(started, 1);

      const second = await fetch(`${base}/${NOTE_ID}/transcribe`, { method: 'POST' });
      assert.equal(second.status, 429);
      const body = await second.json();
      assert.equal(body.code, 'TRANSCRIPTION_BUSY');
      assert.ok(second.headers.get('retry-after'));
      assert.equal(started, 1, 'the AI service must not be called twice at once');

      gate.resolve();
      const firstResponse = await first;
      assert.equal(firstResponse.status, 200);
    });
  } finally {
    delete process.env.MAX_CONCURRENT_TRANSCRIPTIONS;
  }
});

test('transcriptions have an hourly budget per user', async () => {
  process.env.TRANSCRIPTION_LIMIT_PER_HOUR = '2';
  const router = loadRouter({
    transcribeAudio: async () => ({ text: 'hallo', language: 'de', probability: 0.9 })
  });

  try {
    await withServer(router, async base => {
      const url = `${base}/${NOTE_ID}/transcribe`;
      assert.equal((await fetch(url, { method: 'POST' })).status, 200);
      assert.equal((await fetch(url, { method: 'POST' })).status, 200);
      const third = await fetch(url, { method: 'POST' });
      assert.equal(third.status, 429);
      const body = await third.json();
      assert.equal(body.code, 'TRANSCRIPTION_RATE_LIMITED');
      assert.equal(third.headers.get('retry-after'), '600');
    });
  } finally {
    delete process.env.TRANSCRIPTION_LIMIT_PER_HOUR;
  }
});

test('limits are configurable through the environment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../routes/notes.js'), 'utf8');

  for (const variable of [
    'LINK_PREVIEW_LIMIT_PER_MINUTE',
    'TRANSCRIPTION_LIMIT_PER_HOUR',
    'TRANSCRIPTION_LIMIT_PER_DAY',
    'TRANSCRIPTION_MINUTES_PER_DAY',
    'MAX_CONCURRENT_TRANSCRIPTIONS'
  ]) {
    assert.match(source, new RegExp(`numberFromEnv\\('${variable}'`), `${variable} must be configurable`);
  }
  assert.match(source, /const userKeyGenerator = \(req\) => `user:\$\{req\.user\?/);
});

// Audit 2026-09-12 (Top-30 Nr. 18): the budgets counted requests, not audio
// minutes, and an oversized recording surfaced as a generic 500. Now the AI
// service rejects long audio with a stable 413 (carried through aiService),
// and the server keeps a daily audio-minute budget fed by the reported duration.
test('audio beyond the per-file limit is a 413 with a stable code, not a 500', async () => {
  const router = loadRouter({
    transcribeAudio: async () => {
      // Exactly what aiService.transcribeAudio throws after the AI service
      // answered 413 AUDIO_TOO_LONG.
      throw Object.assign(new Error('Audio zu lang'), {
        statusCode: 413, code: 'AUDIO_TOO_LONG', maxSeconds: 900
      });
    }
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/${NOTE_ID}/transcribe`, { method: 'POST' });
    assert.equal(response.status, 413);
    const body = await response.json();
    assert.equal(body.code, 'AUDIO_TOO_LONG');
    assert.match(body.error, /länger als 15 Minuten/);
  });
});

test('transcriptions have a daily audio-minute budget per user', async () => {
  process.env.TRANSCRIPTION_MINUTES_PER_DAY = '1'; // 60 seconds of audio per day
  const router = loadRouter({
    transcribeAudio: async () => ({ text: 'hallo', language: 'de', probability: 0.9, duration: 120 })
  });

  try {
    await withServer(router, async base => {
      const url = `${base}/${NOTE_ID}/transcribe`;
      // The first recording is 2 minutes and busts the 1-minute budget …
      assert.equal((await fetch(url, { method: 'POST' })).status, 200);
      // … so the next one is refused before the AI service is called again.
      const second = await fetch(url, { method: 'POST' });
      assert.equal(second.status, 429);
      const body = await second.json();
      assert.equal(body.code, 'TRANSCRIPTION_MINUTE_LIMIT');
      assert.ok(Number(second.headers.get('retry-after')) > 0);
    });
  } finally {
    delete process.env.TRANSCRIPTION_MINUTES_PER_DAY;
  }
});
