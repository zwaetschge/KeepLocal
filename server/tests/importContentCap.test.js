process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const cookieParser = require('cookie-parser');

// v1.16.0-Review: Die Route-Validierung von POST /api/notes/import/markdown
// darf beim Roh-String nicht enger sein als der Service. Der Service erlaubt
// 20.000 Roh-Zeichen (Body 10.000 + Frontmatter-Spielraum — genau das Format,
// das der Android-Chunk-Import für lange Todo-Notizen schickt); eine 10k-
// Grenze im Validator hätte diese Requests mit 400 abgewiesen, BEVOR die
// präzisere Service-Prüfung sie korrekt einordnen kann. Hier wird nur die
// Validator-Grenze gepinnt — die Service-Semantik deckt markdownImport.test.js ab.

const servicePath = require.resolve('../services/notesService');
const aiPath = require.resolve('../services/aiService');
const previewPath = require.resolve('../services/linkPreviewService');
const authPath = require.resolve('../middleware/auth');
const uploadPath = require.resolve('../middleware/upload');
const magicPath = require.resolve('../utils/magicNumberValidator');
const routerPath = require.resolve('../routes/notes');

const USER_ID = '507f191e810c19729de860ea';

function loadRouter() {
  for (const p of [routerPath, servicePath, aiPath, previewPath, authPath, uploadPath, magicPath]) {
    delete require.cache[p];
  }
  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true,
    // Stub: Die Service-Grenzen (Body 10k) laufen hier nicht — allein die
    // Validator-Grenze steht auf dem Prüfstand.
    exports: { importMarkdownNotes: async () => ({ created: 1 }) }
  };
  require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: {} };
  require.cache[previewPath] = { id: previewPath, filename: previewPath, loaded: true, exports: {} };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: { authenticateToken: (req, _res, next) => { req.user = { _id: USER_ID, isDemo: false }; next(); } }
  };
  require.cache[uploadPath] = {
    id: uploadPath, filename: uploadPath, loaded: true,
    exports: {
      upload: { array: () => (req, _res, next) => next() },
      uploadAudio: { single: () => (req, _res, next) => next() },
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
  app.use(express.json({ limit: '1mb' }));
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

const postItems = (base, content) => fetch(`${base}/import/markdown`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ items: [{ path: '', title: 'Lang', content }] })
});

test('items content: 20.000 Roh-Zeichen passieren die Route-Validierung, 20.001 nicht', async () => {
  const router = loadRouter();
  await withServer(router, async (base) => {
    const atLimit = await postItems(base, 'x'.repeat(20000));
    assert.equal(atLimit.status, 201, 'exakt 20.000 erreichen den Service (Frontmatter-Spielraum)');

    const overLimit = await postItems(base, 'x'.repeat(20001));
    assert.equal(overLimit.status, 400);
    const body = await overLimit.json();
    const detail = (body.details || []).map((e) => e.msg || e).join(' ');
    assert.match(detail, /20\.000/,
      'die Validator-Meldung nennt die tatsächliche Grenze');
  });
});
