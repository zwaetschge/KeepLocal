const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Regression guards for BUG_REPORT_2026-09-10 #2 and #8:
//  - a link preview without an image (`image: ""`, exactly what the server's own
//    /api/notes/link-preview returns for pages without og:image) must not fail
//    validation — otherwise no note containing such a link can ever be saved;
//  - an upstream answer that is not 200 must not become a 500.

const servicePath = require.resolve('../services/notesService');
const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/notes');
const linkPreviewPath = require.resolve('../utils/linkPreview');

const NOTE_ID = '507f1f77bcf86cd799439011';

function loadRouter({ createNote, updateNote, fetchLinkPreview }) {
  delete require.cache[routerPath];
  delete require.cache[servicePath];
  delete require.cache[authPath];
  delete require.cache[linkPreviewPath];
  require.cache[servicePath] = {
    id: servicePath, filename: servicePath, loaded: true,
    exports: { createNote, updateNote }
  };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => {
        req.user = { _id: 'user-id', isDemo: false };
        next();
      }
    }
  };
  require.cache[linkPreviewPath] = {
    id: linkPreviewPath, filename: linkPreviewPath, loaded: true,
    exports: { fetchLinkPreview }
  };
  return require(routerPath);
}

function cleanup() {
  for (const p of [routerPath, servicePath, authPath, linkPreviewPath]) {
    delete require.cache[p];
  }
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
    cleanup();
  }
}

const PREVIEW_WITHOUT_IMAGE = {
  url: 'https://example.com/',
  title: 'Example Domain',
  description: '',
  image: '',
  siteName: 'example.com'
};

test('POST /api/notes accepts a link preview whose image is an empty string', async () => {
  let receivedBody = null;
  const router = loadRouter({
    createNote: async (noteData) => {
      receivedBody = noteData;
      return { _id: NOTE_ID, ...noteData };
    }
  });

  await withServer(router, async base => {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Link note',
        content: 'Siehe https://example.com/ fuer Infos',
        linkPreviews: [PREVIEW_WITHOUT_IMAGE]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201, `expected 201, got ${response.status}: ${JSON.stringify(body)}`);
    assert.deepEqual(receivedBody.linkPreviews, [PREVIEW_WITHOUT_IMAGE]);
  });
});

test('PUT /api/notes/:id accepts a link preview whose image is an empty string', async () => {
  const router = loadRouter({
    updateNote: async (noteId, noteData) => ({ _id: noteId, ...noteData })
  });

  await withServer(router, async base => {
    const response = await fetch(`${base}/${NOTE_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'editiert', linkPreviews: [PREVIEW_WITHOUT_IMAGE] })
    });
    const body = await response.json();

    assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  });
});

test('a real image URL is still validated as a URL', async () => {
  const router = loadRouter({ createNote: async (noteData) => ({ _id: NOTE_ID, ...noteData }) });

  await withServer(router, async base => {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'x',
        linkPreviews: [{ ...PREVIEW_WITHOUT_IMAGE, image: 'not a url' }]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.details[0].path, 'linkPreviews[0].image');
  });
});

test('POST /api/notes/link-preview forwards the upstream status instead of 500', async () => {
  const upstreamError = new Error('Zielseite antwortete mit HTTP 404');
  upstreamError.statusCode = 502;
  const router = loadRouter({ fetchLinkPreview: async () => { throw upstreamError; } });

  await withServer(router, async base => {
    const response = await fetch(`${base}/link-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/missing' })
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.error, 'Zielseite antwortete mit HTTP 404');
  });
});

test('a non-200 upstream response is rejected as 502, not as an untyped error', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utils/linkPreview.js'), 'utf8');

  assert.match(
    source,
    /if \(response\.statusCode !== 200\) \{[\s\S]{0,600}?upstreamError\.statusCode = 502;/,
    'the non-200 branch must tag the error with 502'
  );
  assert.doesNotMatch(
    source,
    /reject\(new Error\(`HTTP \$\{response\.statusCode\}`\)\)/,
    'untyped HTTP errors become 500s in the route'
  );
});

test('POST /api/notes/link-preview maps upstream network failures to 502', async () => {
  const dnsError = new Error('getaddrinfo ENOTFOUND example.invalid');
  dnsError.code = 'ENOTFOUND';
  const router = loadRouter({ fetchLinkPreview: async () => { throw dnsError; } });

  await withServer(router, async base => {
    const response = await fetch(`${base}/link-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.invalid/page' })
    });
    const body = await response.json();

    assert.equal(response.status, 502, `expected 502, got ${response.status}: ${JSON.stringify(body)}`);
    assert.equal(body.error, 'Link ist nicht erreichbar');
  });
});

test('POST /api/notes/link-preview maps a socket timeout to 502', async () => {
  const timeoutError = new Error('Request timeout');
  const router = loadRouter({ fetchLinkPreview: async () => { throw timeoutError; } });

  await withServer(router, async base => {
    const response = await fetch(`${base}/link-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/slow' })
    });
    assert.equal(response.status, 502);
  });
});
