const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET ||= 'csrf-regression-test-secret-at-least-32-characters';
const { createCsrfToken, issueCsrfToken, csrfProtection } = require('../../server/middleware/csrfProtection');
let fixtureId = 0;

// Execute the actual browser modules, resolving Vite's extensionless imports
// for Node and supplying only its build-time import.meta.env value.
async function modules(t) {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const cache = new Map(), id = ++fixtureId;
  function url(file) {
    if (cache.has(file)) return cache.get(file);
    let source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env', '({PROD: true})');
    source = source.replace(/from\s+(['"])(\.[^'"]+)\1/g, (_, quote, relative) => {
      let target = path.resolve(path.dirname(file), relative);
      if (!path.extname(target)) target += '.js';
      return `from '${url(target)}'`;
    });
    const result = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${id}`;
    cache.set(file, result);
    return result;
  }
  const load = name => import(url(path.resolve(__dirname, '../src/services/api', name)));
  const utils = await load('apiUtils.js');
  return { ...utils, notes: (await load('notesAPI.js')).default, auth: (await load('authAPI.js')).default };
}

function backend(t, { permissionDenied = false, rejectCookies = false, legacy = false } = {}) {
  const calls = [];
  let cookie;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const headers = new Headers(options.headers);
    calls.push({ url, options, headers });
    if (url.endsWith('/api/csrf-token')) {
      // Delay to expose concurrent startup token requests.
      await new Promise(resolve => setTimeout(resolve, 5));
      const token = issueCsrfToken({ cookies: { kl_csrf: cookie } }, {
        cookie: (name, value) => { if (!rejectCookies) cookie = value; },
      });
      return Response.json({ csrfToken: token });
    }
    if (permissionDenied) return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    let rejected;
    csrfProtection({ method: options.method || 'GET', cookies: { kl_csrf: cookie },
      headers: { 'x-csrf-token': headers.get('X-CSRF-Token') } }, {
      status: () => ({ json: payload => { rejected = payload; } }),
    }, () => {});
    if (rejected) return Response.json({ ...rejected, ...(!legacy && { code: 'CSRF_INVALID' }) }, { status: 403 });
    return Response.json({ ok: true, user: { id: 'test-user' } });
  });
  return {
    calls,
    tokens: () => calls.filter(c => c.url.endsWith('/api/csrf-token')),
    writes: () => calls.filter(c => c.options.method === 'POST' || c.options.method === 'patch'),
  };
}

test('startup and a first upload share one CSRF request before sending FormData', async t => {
  const api = await modules(t), server = backend(t);
  const recording = new Blob(['audio'], { type: 'audio/webm' });
  const results = await Promise.all([api.initializeCSRF(), api.initializeCSRF(), api.notes.uploadRecording('note', recording)]);
  assert.equal(results[2].ok, true);
  assert.equal(server.tokens().length, 1);
  assert.equal(server.writes().length, 1);
  assert.equal(server.tokens()[0].options.cache, 'no-store');
  assert.equal(server.writes()[0].headers.has('Content-Type'), false, 'browser must supply the multipart boundary');
  assert.equal(server.writes()[0].options.credentials, 'include');
});

test('expired CSRF cookies recover an upload once without losing its file', async t => {
  const api = await modules(t), server = backend(t);
  api.setCsrfToken(createCsrfToken());
  assert.equal((await api.notes.uploadRecording('note', new Blob(['retained audio']))).ok, true);
  assert.equal(server.tokens().length, 1);
  assert.equal(server.writes().length, 2);
  assert.equal(server.writes()[0].options.body, server.writes()[1].options.body);
  assert.equal(await server.writes()[1].options.body.get('audio').text(), 'retained audio');
  assert.notEqual(server.writes()[0].headers.get('X-CSRF-Token'), server.writes()[1].headers.get('X-CSRF-Token'));
});

test('simultaneous expired JSON writes share one CSRF recovery', async t => {
  const api = await modules(t), server = backend(t);
  api.setCsrfToken(createCsrfToken());
  const results = await Promise.all([1, 2, 3].map(id => api.fetchWithAuth(`/api/notes/${id}`, { method: 'patch', body: '{}' })));
  assert.ok(results.every(r => r.ok));
  assert.equal(server.tokens().length, 1);
  assert.equal(server.writes().length, 6);
});

test('login also recovers a stale token against legacy server errors', async t => {
  const api = await modules(t), server = backend(t, { legacy: true });
  api.setCsrfToken(createCsrfToken());
  assert.equal((await api.auth.login('synthetic@example.com', 'synthetic')).user.id, 'test-user');
  assert.equal(server.writes().length, 2);
});

test('permission denials never repeat writes or refresh CSRF', async t => {
  const api = await modules(t), server = backend(t, { permissionDenied: true });
  api.setCsrfToken(createCsrfToken());
  await assert.rejects(api.fetchWithAuth('/api/notes', { method: 'POST', body: '{}' }), error => error.code === 'FORBIDDEN');
  assert.equal(server.writes().length, 1);
  assert.equal(server.tokens().length, 0);
});

test('blocked cookies surface CSRF_INVALID after a single retry', async t => {
  const api = await modules(t), server = backend(t, { rejectCookies: true });
  api.setCsrfToken(createCsrfToken());
  await assert.rejects(api.notes.uploadRecording('note', new Blob(['audio'])), error => error.code === 'CSRF_INVALID');
  assert.equal(server.tokens().length, 1);
  assert.equal(server.writes().length, 2);
});

test('reads do not initialize CSRF and aborts prevent a mutation', async t => {
  const api = await modules(t), server = backend(t);
  await api.fetchWithAuth('/api/notes');
  assert.equal(server.tokens().length, 0);
  const controller = new AbortController();
  controller.abort(new DOMException('Request aborted', 'AbortError'));
  await assert.rejects(api.fetchWithAuth('/api/notes', { method: 'POST', signal: controller.signal }), error => error.code === 'ABORTED');
  assert.equal(server.writes().length, 0);
});
