const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  blockDemoUser,
  createDemoNoteLimitMiddleware,
  isDemoMode,
  parseDemoNoteLimit,
  rejectDemoNoteCapabilities,
  shouldRevokeAllSessionsOnLogout
} = require('../middleware/demoPolicy');
const {
  DEMO_NOTE_IDS,
  buildDemoFixtures,
  getDemoConfig,
  parseResetIntervalHours
} = require('../scripts/demoReset');

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('demo mode is explicit and its numeric limits are bounded', () => {
  assert.equal(isDemoMode({ DEMO_MODE: 'true' }), true);
  assert.equal(isDemoMode({ DEMO_MODE: 'TRUE' }), false);
  assert.equal(isDemoMode({}), false);

  assert.equal(parseDemoNoteLimit(undefined), 100);
  assert.equal(parseDemoNoteLimit('0'), 100);
  assert.equal(parseDemoNoteLimit('42'), 42);
  assert.equal(parseDemoNoteLimit('9999'), 500);

  assert.equal(parseResetIntervalHours(undefined), 6);
  assert.equal(parseResetIntervalHours('12'), 12);
  assert.equal(parseResetIntervalHours('9999'), 168);
});

test('demo-only middleware blocks high-risk features without affecting normal users', () => {
  const blocked = responseRecorder();
  let continued = false;
  blockDemoUser('uploads')(
    { user: { isDemo: true } },
    blocked,
    () => { continued = true; }
  );
  assert.equal(continued, false);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.payload.code, 'DEMO_FEATURE_DISABLED');
  assert.equal(blocked.payload.feature, 'uploads');

  const allowed = responseRecorder();
  blockDemoUser('uploads')(
    { user: { isDemo: false } },
    allowed,
    () => { continued = true; }
  );
  assert.equal(continued, true);
  assert.equal(allowed.statusCode, null);
});

test('demo notes accept ordinary content but reject attached preview data', () => {
  let continued = false;
  rejectDemoNoteCapabilities(
    { user: { isDemo: true }, body: { content: 'ok', linkPreviews: [] } },
    responseRecorder(),
    () => { continued = true; }
  );
  assert.equal(continued, true);

  const blocked = responseRecorder();
  rejectDemoNoteCapabilities(
    {
      user: { isDemo: true },
      body: { linkPreviews: [{ url: 'https://example.com' }] }
    },
    blocked,
    () => assert.fail('restricted demo note data must not continue')
  );
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.payload.feature, 'note_attachments');
});

test('demo note limit is checked per owner and returns a stable error contract', async () => {
  const previousLimit = process.env.DEMO_NOTE_LIMIT;
  process.env.DEMO_NOTE_LIMIT = '4';
  let query;
  const middleware = createDemoNoteLimitMiddleware(async value => {
    query = value;
    return 4;
  });
  const response = responseRecorder();

  try {
    await middleware(
      { user: { _id: 'demo-user-id', isDemo: true } },
      response,
      () => assert.fail('a full demo account must not create another note')
    );
  } finally {
    if (previousLimit === undefined) delete process.env.DEMO_NOTE_LIMIT;
    else process.env.DEMO_NOTE_LIMIT = previousLimit;
  }

  assert.deepEqual(query, { userId: 'demo-user-id' });
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.code, 'DEMO_NOTE_LIMIT');
});

test('parallel demo note creates are serialized around the quota check', async () => {
  const previousLimit = process.env.DEMO_NOTE_LIMIT;
  process.env.DEMO_NOTE_LIMIT = '100';
  let countCalls = 0;
  const middleware = createDemoNoteLimitMiddleware(async () => {
    countCalls += 1;
    return 4;
  });
  const firstResponse = new EventEmitter();
  const secondResponse = new EventEmitter();
  let firstContinued = false;
  let secondContinued = false;

  try {
    await middleware(
      { user: { _id: 'demo-user-id', isDemo: true } },
      firstResponse,
      () => { firstContinued = true; }
    );
    const secondRequest = middleware(
      { user: { _id: 'demo-user-id', isDemo: true } },
      secondResponse,
      () => { secondContinued = true; }
    );

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(firstContinued, true);
    assert.equal(secondContinued, false);
    assert.equal(countCalls, 1);

    firstResponse.emit('finish');
    await secondRequest;
    assert.equal(secondContinued, true);
    assert.equal(countCalls, 2);
    secondResponse.emit('finish');
  } finally {
    if (previousLimit === undefined) delete process.env.DEMO_NOTE_LIMIT;
    else process.env.DEMO_NOTE_LIMIT = previousLimit;
  }
});

test('logging out of one shared demo session does not revoke other visitors', () => {
  assert.equal(shouldRevokeAllSessionsOnLogout({ isDemo: true }), false);
  assert.equal(shouldRevokeAllSessionsOnLogout({ isDemo: false }), true);
  assert.equal(shouldRevokeAllSessionsOnLogout(null), false);

  const authRoutes = fs.readFileSync(path.join(root, 'routes/auth.js'), 'utf8');
  assert.match(authRoutes, /shouldRevokeAllSessionsOnLogout\(req\.user\)/);
  assert.match(authRoutes, /router\.post\('\/demo'/);
  assert.match(authRoutes, /isDemo:\s*user\.isDemo === true/);
  assert.match(authRoutes, /demo\s*\n\s*\}/);
});

test('the user model permits exactly one non-admin demo identity', () => {
  const User = require('../models/User');
  const demoPath = User.schema.path('isDemo');
  const demoIndex = User.schema.indexes()
    .find(([, options]) => options.name === 'single_demo_user');

  assert.ok(demoPath);
  assert.equal(demoPath.defaultValue, false);
  assert.ok(demoIndex);
  assert.equal(demoIndex[1].unique, true);
  assert.deepEqual(demoIndex[1].partialFilterExpression, { isDemo: true });
});

test('demo reset fixtures are deterministic and exercise core note states', () => {
  const userId = '66d000000000000000000099';
  const now = new Date('2026-07-17T12:00:00.000Z');
  const fixtures = buildDemoFixtures(userId, now);
  const secondBuild = buildDemoFixtures(userId, now);

  assert.equal(fixtures.length, 4);
  assert.deepEqual(fixtures, secondBuild);
  assert.deepEqual(fixtures.map(note => note._id.toString()), DEMO_NOTE_IDS);
  assert.equal(fixtures.filter(note => note.isPinned).length, 1);
  assert.equal(fixtures.filter(note => note.isTodoList).length, 1);
  assert.equal(fixtures.filter(note => note.isArchived).length, 1);
  assert.ok(fixtures.every(note => note.userId === userId));

  const config = getDemoConfig({});
  assert.equal(config.username, 'demo');
  assert.equal(config.email, 'demo@keeplocal.invalid');
  assert.equal(config.resetIntervalHours, 6);
});

test('all restricted routes and the reset worker are wired into deployment', () => {
  const notes = fs.readFileSync(path.join(root, 'routes/notes.js'), 'utf8');
  const apiKeys = fs.readFileSync(path.join(root, 'routes/apiKeys.js'), 'utf8');
  const friends = fs.readFileSync(path.join(root, 'routes/friends.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const supervisor = fs.readFileSync(path.join(root, '../supervisord.conf'), 'utf8');

  assert.match(notes, /blockDemoCollaboration/);
  assert.match(notes, /blockDemoLinkPreview/);
  assert.match(notes, /blockDemoUploads/);
  assert.match(notes, /blockDemoTranscription/);
  assert.match(notes, /enforceDemoNoteLimit/);
  assert.match(apiKeys, /router\.use\(blockDemoUser\('api_keys'\)\)/);
  assert.match(friends, /router\.use\(blockDemoUser\('collaboration'\)\)/);
  assert.match(server, /'\/api\/auth\/demo'/);
  assert.match(supervisor, /\[program:demo-reset\]/);
  assert.match(supervisor, /programs=mongodb,ai,demo-reset,nodejs,nginx/);
  assert.doesNotMatch(supervisor, /^environment=/m);
});

test('API and upload responses are marked private and non-cacheable', () => {
  const noStore = require('../middleware/noStore');
  const headers = {};
  let continued = false;
  noStore({}, {
    setHeader(name, value) {
      headers[name] = value;
    }
  }, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(headers.Pragma, 'no-cache');
  assert.equal(headers.Expires, '0');

  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /app\.use\(\['\/api', '\/uploads'\], noStore\)/);
});
