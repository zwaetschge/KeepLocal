process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const cookieParser = require('cookie-parser');

// Improvement #6 (VERBESSERUNGEN_2026-09-11): theme, UI language and AI flags
// lived in localStorage only — a new device started at the defaults and a shared
// machine kept the previous user's settings. They are account preferences now.

const userModelPath = require.resolve('../models/User');
const authMiddlewarePath = require.resolve('../middleware/auth');
const authRouterPath = require.resolve('../routes/auth');
const { generateToken } = require('../middleware/auth');

const USER_ID = '507f191e810c19729de860ea';

function loadRouter(userDoc) {
  const state = { updates: [] };

  class UserMock {
    constructor(data) { Object.assign(this, data); }
    async save() { return this; }
  }
  UserMock.findById = () => ({
    select: () => ({
      then: (resolve) => resolve(userDoc),
      catch: () => {}
    }),
    then: (resolve) => resolve(userDoc)
  });
  UserMock.findByIdAndUpdate = async (id, update) => {
    state.updates.push({ id: String(id), update });
    // Apply the dotted paths onto a copy so the response looks real.
    const next = JSON.parse(JSON.stringify({ ...userDoc, preferences: userDoc.preferences || {} }));
    for (const [key, value] of Object.entries(update.$set)) {
      const parts = key.split('.');
      let target = next;
      while (parts.length > 1) {
        const part = parts.shift();
        target[part] = target[part] || {};
        target = target[part];
      }
      target[parts[0]] = value;
    }
    return next;
  };
  UserMock.findOne = async () => null;
  UserMock.countDocuments = async () => 1;

  for (const p of [authRouterPath, userModelPath, authMiddlewarePath]) delete require.cache[p];
  require.cache[userModelPath] = { id: userModelPath, filename: userModelPath, loaded: true, exports: UserMock };
  const authMiddleware = require(authMiddlewarePath);
  return { router: require(authRouterPath), state, generateToken: authMiddleware.generateToken };
}

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/auth`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [authRouterPath, userModelPath, authMiddlewarePath]) delete require.cache[p];
  }
}

const baseUser = (preferences) => ({
  _id: USER_ID,
  username: 'alice',
  email: 'alice@example.com',
  isAdmin: true,
  isDemo: false,
  sessionVersion: 0,
  preferences
});

async function put(base, token, body) {
  const response = await fetch(`${base}/preferences`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: `kl_session=${token}` },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test('PUT /api/auth/preferences stores whitelisted fields with dotted paths', async () => {
  const { router, state } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const token = generateToken(USER_ID, 0);
    const { status, body } = await put(base, token, {
      theme: 'oled',
      language: 'en',
      aiFeatures: { voiceTranscription: true },
      transcriptionLanguage: 'de',
      isAdmin: false,
      email: 'hijack@example.com'
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.preferences, {
      theme: 'oled',
      language: 'en',
      aiFeatures: { voiceTranscription: true },
      transcriptionLanguage: 'de',
      renderMarkdown: true,
      tagColors: {},
      savedSearches: [],
      journalFolderId: null
    });
    assert.deepEqual(state.updates[0].update.$set, {
      'preferences.theme': 'oled',
      'preferences.language': 'en',
      'preferences.aiFeatures.voiceTranscription': true,
      'preferences.transcriptionLanguage': 'de'
    }, 'unknown keys must never reach the database');
  });
});

test('PUT /api/auth/preferences accepts partial updates', async () => {
  const { router, state } = loadRouter(baseUser({ theme: 'dark' }));

  await withServer(router, async base => {
    const { status } = await put(base, generateToken(USER_ID, 0), { theme: 'eink' });
    assert.equal(status, 200);
    assert.deepEqual(state.updates[0].update.$set, { 'preferences.theme': 'eink' });
  });
});

test('PUT /api/auth/preferences rejects invalid values', async () => {
  const { router, state } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const token = generateToken(USER_ID, 0);
    const cases = [
      [{ theme: 'neon' }, 400],
      [{ language: 'fr' }, 400],
      [{ aiFeatures: 'yes' }, 400],
      [{ aiFeatures: [] }, 400],
      [{ aiFeatures: { voiceTranscription: 'true' } }, 400],
      [{ transcriptionLanguage: 'Klingon' }, 400],
      [{ transcriptionLanguage: 'x'.repeat(21) }, 400],
      [{ unrelated: 1 }, 400],
      [{}, 400]
    ];
    for (const [payload, expected] of cases) {
      const { status } = await put(base, token, payload);
      assert.equal(status, expected, `payload ${JSON.stringify(payload)} -> ${status}`);
    }
    assert.equal(state.updates.length, 0, 'nothing may be written for invalid payloads');
  });
});

test('language may be cleared back to "follow the browser"', async () => {
  const { router, state } = loadRouter(baseUser({ language: 'de' }));

  await withServer(router, async base => {
    const { status, body } = await put(base, generateToken(USER_ID, 0), { language: null });
    assert.equal(status, 200);
    assert.equal(body.preferences.language, null);
    assert.deepEqual(state.updates[0].update.$set, { 'preferences.language': null });
  });
});

test('preferences require a session', async () => {
  const { router } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const response = await fetch(`${base}/preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' })
    });
    assert.equal(response.status, 401);
  });
});

test('GET /api/auth/me reports preferences with safe defaults', async () => {
  const { router } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const response = await fetch(`${base}/me`, {
      headers: { cookie: `kl_session=${generateToken(USER_ID, 0)}` }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.user.preferences, {
      theme: 'light',
      language: null,
      aiFeatures: { voiceTranscription: false },
      transcriptionLanguage: 'auto',
      renderMarkdown: true,
      tagColors: {},
      savedSearches: [],
      journalFolderId: null
    });
    assert.equal(body.user.password, undefined);
    assert.equal(body.user.sessionVersion, undefined);
  });
});

test('the user model stores preferences as a typed subdocument', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../models/User.js'), 'utf8');

  assert.match(source, /preferences: \{/);
  assert.match(source, /enum: \['light', 'dark', 'oled', 'eink', 'doodle'\]/);
  assert.match(source, /enum: \['de', 'en', null\]/);
  assert.match(source, /voiceTranscription: \{/);
  assert.match(source, /transcriptionLanguage: \{/);
  assert.match(source, /renderMarkdown: \{/);
  assert.match(source, /tagColors: \{/);
  assert.match(source, /savedSearches: \[/);
  assert.match(source, /journalFolderId: \{/);
});

// v1.10.0: Tag-Farben, gespeicherte Suchen und Journal-Wurzel — dieselbe
// Whitelist-Disziplin wie Theme/Sprache: unbekannte Werte fliegen raus bzw.
// werden abgelehnt, bevor etwas die Datenbank erreicht.

test('PUT /api/auth/preferences stores tag colors from the card palette', async () => {
  const { router, state } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const { status, body } = await put(base, generateToken(USER_ID, 0), {
      tagColors: { arbeit: '#f28b82', 'Rezepte-süß': '#aecbfa' }
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.preferences.tagColors, { arbeit: '#f28b82', 'Rezepte-süß': '#aecbfa' });
    assert.deepEqual(state.updates[0].update.$set, {
      'preferences.tagColors': { arbeit: '#f28b82', 'Rezepte-süß': '#aecbfa' }
    });
  });
});

test('PUT /api/auth/preferences rejects invalid tag colors', async () => {
  const { router, state } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const token = generateToken(USER_ID, 0);
    const cases = [
      [{ tagColors: { arbeit: '#ff0000' } }, 'Farbe außerhalb der Karten-Palette'],
      [{ tagColors: { arbeit: 'red' } }, 'kein Hex'],
      [{ tagColors: { 'bad tag!': '#f28b82' } }, 'Tag-Zeichen outside the tag pattern'],
      [{ tagColors: null }, 'null statt Objekt'],
      [{ tagColors: [] }, 'Array statt Objekt'],
      [{ tagColors: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`tag${i}`, '#f28b82'])) }, '>200 Eintraege']
    ];
    for (const [payload, why] of cases) {
      const { status } = await put(base, token, payload);
      assert.equal(status, 400, `${why} -> ${status}`);
    }
    assert.equal(state.updates.length, 0, 'nothing may be written for invalid payloads');
  });
});

test('PUT /api/auth/preferences stores saved searches as a normalized list', async () => {
  const { router, state } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const { status, body } = await put(base, generateToken(USER_ID, 0), {
      savedSearches: [
        { id: 'work', name: '  Arbeit  ', query: 'meeting', typeFilter: 'lists', tag: 'job' },
        { id: 'pins', name: 'Angeheftet' }
      ]
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.preferences.savedSearches, [
      { id: 'work', name: 'Arbeit', query: 'meeting', typeFilter: 'lists', tag: 'job' },
      { id: 'pins', name: 'Angeheftet', query: '', typeFilter: 'all', tag: '' }
    ]);
    assert.equal(state.updates[0].update.$set['preferences.savedSearches'][0].name, 'Arbeit');
  });
});

test('PUT /api/auth/preferences rejects invalid saved searches', async () => {
  const { router, state } = loadRouter(baseUser(undefined));

  await withServer(router, async base => {
    const token = generateToken(USER_ID, 0);
    const cases = [
      [{ savedSearches: 'work' }, 'kein Array'],
      [{ savedSearches: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }, 'doppelte ID'],
      [{ savedSearches: [{ name: 'Ohne ID' }] }, 'id fehlt'],
      [{ savedSearches: [{ id: 'a b', name: 'A' }] }, 'id mit Leerzeichen'],
      [{ savedSearches: [{ id: 'a' }] }, 'name fehlt'],
      [{ savedSearches: [{ id: 'a', name: 'x'.repeat(51) }] }, 'name zu lang'],
      [{ savedSearches: [{ id: 'a', name: 'A', typeFilter: 'videos' }] }, 'unbekannter Filter'],
      [{ savedSearches: [{ id: 'a', name: 'A', query: 'x'.repeat(201) }] }, 'query zu lang'],
      [{ savedSearches: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, name: `S${i}` })) }, '>20 Eintraege']
    ];
    for (const [payload, why] of cases) {
      const { status } = await put(base, token, payload);
      assert.equal(status, 400, `${why} -> ${status}`);
    }
    assert.equal(state.updates.length, 0, 'nothing may be written for invalid payloads');
  });
});

test('PUT /api/auth/preferences stores the journal root id and accepts null', async () => {
  const { router, state } = loadRouter(baseUser({ journalFolderId: '507f1f77bcf86cd799439011' }));

  await withServer(router, async base => {
    const token = generateToken(USER_ID, 0);
    const keep = await put(base, token, { journalFolderId: '507f1f77bcf86cd799439012' });
    assert.equal(keep.status, 200, JSON.stringify(keep.body));
    assert.equal(keep.body.preferences.journalFolderId, '507f1f77bcf86cd799439012');

    const clear = await put(base, token, { journalFolderId: null });
    assert.equal(clear.status, 200);
    assert.equal(clear.body.preferences.journalFolderId, null);

    const bad = await put(base, token, { journalFolderId: 'not-an-id' });
    assert.equal(bad.status, 400);
    assert.equal(state.updates.length, 2);
  });
});

// v1.13.0: Markdown-Rendering der Karten — Boolean mit Default true, damit
// Bestandskonten (Trilium-Import) sofort gerenderte Notizen sehen.
test('PUT /api/auth/preferences stores the markdown rendering flag', async () => {
  const { router, state } = loadRouter(baseUser({ renderMarkdown: true }));

  await withServer(router, async base => {
    const token = generateToken(USER_ID, 0);
    const off = await put(base, token, { renderMarkdown: false });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(off.body.preferences.renderMarkdown, false);
    assert.deepEqual(state.updates[0].update.$set, { 'preferences.renderMarkdown': false });

    const bad = await put(base, token, { renderMarkdown: 'nope' });
    assert.equal(bad.status, 400);
    assert.equal(state.updates.length, 1, 'invalid value must not be written');
  });
});

test('GET /api/auth/me reports saved searches and tag colors back to other devices', async () => {
  const { router } = loadRouter(baseUser({
    tagColors: { arbeit: '#f28b82' },
    savedSearches: [{ _id: 'ignored', id: 'work', name: 'Arbeit', query: '', typeFilter: 'all', tag: '' }],
    journalFolderId: '507f1f77bcf86cd799439011'
  }));

  await withServer(router, async base => {
    const response = await fetch(`${base}/me`, {
      headers: { cookie: `kl_session=${generateToken(USER_ID, 0)}` }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.user.preferences.tagColors, { arbeit: '#f28b82' });
    assert.deepEqual(body.user.preferences.savedSearches, [
      { id: 'work', name: 'Arbeit', query: '', typeFilter: 'all', tag: '' }
    ], 'subdocument internals wie _id duerfen nicht serialisiert werden');
    assert.equal(body.user.preferences.journalFolderId, '507f1f77bcf86cd799439011');
  });
});
