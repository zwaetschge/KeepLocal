const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 9): The Whisper service accepted /transcribe
// from anyone who could reach it — no credential at all. In the all-in-one image
// it binds to loopback, in split compose it is a service on the backend network.
// "Internal" is not a credential, so node and Flask now share a bearer token.
// Second half of the finding: the concurrency gate defaulted to 2 while gunicorn
// runs `--workers 1`, so the second request did not get an honest 429 — it
// waited until the 300 s axios timeout.

const root = path.resolve(__dirname, '../..');
const aiServicePath = require.resolve('../services/aiService');
const axiosPath = require.resolve('axios');

function loadAiService() {
  delete require.cache[aiServicePath];
  return require(aiServicePath);
}

function stubAxios(captured) {
  const original = require.cache[axiosPath];
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: {
      post: async (url, form, config) => {
        captured.url = url;
        captured.headers = config.headers;
        return { data: { text: 'hallo', language: 'de', probability: 0.9 } };
      }
    }
  };
  return () => {
    if (original) require.cache[axiosPath] = original;
    else delete require.cache[axiosPath];
  };
}

test('the AI service sends the shared token as a bearer header', async () => {
  const captured = {};
  const restore = stubAxios(captured);
  process.env.AI_SERVICE_TOKEN = 'token-aus-env';
  process.env.AI_SERVICE_URL = 'http://ai:5000';
  fs.writeFileSync('/tmp/ai-auth-probe.wav', 'x');
  try {
    const aiService = loadAiService();
    await aiService.transcribeAudio('/tmp/ai-auth-probe.wav', 'de', 'req-1');

    assert.equal(captured.headers.Authorization, 'Bearer token-aus-env');
    assert.equal(captured.headers['X-Request-Id'], 'req-1');
  } finally {
    restore();
    delete process.env.AI_SERVICE_TOKEN;
    fs.rmSync('/tmp/ai-auth-probe.wav', { force: true });
  }
});

test('without a configured token no Authorization header is sent', async () => {
  const captured = {};
  const restore = stubAxios(captured);
  delete process.env.AI_SERVICE_TOKEN;
  fs.writeFileSync('/tmp/ai-auth-probe.wav', 'x');
  try {
    const aiService = loadAiService();
    await aiService.transcribeAudio('/tmp/ai-auth-probe.wav');

    assert.equal(captured.headers.Authorization, undefined);
  } finally {
    restore();
    fs.rmSync('/tmp/ai-auth-probe.wav', { force: true });
  }
});

test('a rejected token becomes a deployment error, not a leaked secret', async () => {
  const original = require.cache[axiosPath];
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: {
      post: async () => {
        const error = new Error('Request failed with status code 401');
        error.response = { status: 401, data: { error: 'Unauthorized' }, statusText: 'Unauthorized' };
        throw error;
      }
    }
  };
  process.env.AI_SERVICE_TOKEN = 'geheim-123';
  fs.writeFileSync('/tmp/ai-auth-probe.wav', 'x');
  try {
    const aiService = loadAiService();
    await assert.rejects(
      aiService.transcribeAudio('/tmp/ai-auth-probe.wav'),
      (error) => {
        assert.match(error.message, /AI_SERVICE_TOKEN/);
        assert.equal(error.message.includes('geheim-123'), false, 'the token must never be echoed');
        return true;
      }
    );
  } finally {
    if (original) require.cache[axiosPath] = original;
    else delete require.cache[axiosPath];
    delete process.env.AI_SERVICE_TOKEN;
    fs.rmSync('/tmp/ai-auth-probe.wav', { force: true });
  }
});

test('the Flask service enforces the token on /transcribe but not on /health', () => {
  const app = fs.readFileSync(path.join(root, 'ai/app.py'), 'utf8');

  assert.match(app, /def is_authorized\(\):/);
  assert.match(app, /hmac\.compare_digest/, 'the comparison must be constant time');
  assert.match(app, /AI_SERVICE_TOKEN/);
  assert.match(app, /'code': 'AI_UNAUTHORIZED'\}\), 401/);
  // Reihenfolge: erst Auth, dann Payload-Prüfung.
  assert.ok(app.indexOf('if not is_authorized():') < app.indexOf("if 'audio' not in request.files"));
  // /health bleibt offen (Container-Healthchecks, Readiness-Probe des Servers).
  const healthRoute = app.slice(app.indexOf("@app.route('/health'"), app.indexOf("@app.route('/transcribe'"));
  assert.doesNotMatch(healthRoute, /is_authorized/);

  const tests = fs.readFileSync(path.join(root, 'ai/test_app.py'), 'utf8');
  assert.match(tests, /class ServiceTokenTest/);
  assert.match(tests, /AI_SERVICE_TOKEN.*s3cret-token/s);
});

test('the all-in-one entrypoint generates a per-boot token and never logs it', () => {
  const entrypoint = fs.readFileSync(path.join(root, 'entrypoint.sh'), 'utf8');

  assert.match(entrypoint, /if \[ -z "\$AI_SERVICE_TOKEN" \]; then/);
  assert.match(entrypoint, /head -c 32 \/dev\/urandom \| od -An -tx1 \| tr -d ' \\n'/);
  assert.match(entrypoint, /export AI_SERVICE_TOKEN/, 'supervisord children inherit exported variables');
  assert.doesNotMatch(entrypoint, /echo[^\n]*\$AI_SERVICE_TOKEN/, 'the token must not be printed');
  // supervisord darf kein eigenes environment= setzen, sonst erbt es nicht.
  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
  assert.doesNotMatch(supervisor, /^environment=/m);
});

test('every deployment variant can pass the token to both services', () => {
  for (const filename of ['docker-compose.yml', 'docker-compose.npm.yml']) {
    const compose = fs.readFileSync(path.join(root, filename), 'utf8');
    const aiService = compose.slice(compose.indexOf('\n  ai:'), compose.indexOf('\n  server:'));
    const serverService = compose.slice(compose.indexOf('\n  server:'));

    assert.match(aiService, /AI_SERVICE_TOKEN=\$\{AI_SERVICE_TOKEN:-\}/, `${filename}: ai needs the token`);
    assert.match(serverService, /AI_SERVICE_TOKEN=\$\{AI_SERVICE_TOKEN:-\}/, `${filename}: server needs the token`);
  }

  const allInOne = fs.readFileSync(path.join(root, 'docker-compose.allinone.yml'), 'utf8');
  assert.match(allInOne, /AI_SERVICE_TOKEN=\$\{AI_SERVICE_TOKEN:-\}/);

  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(envExample, /^AI_SERVICE_TOKEN=/m);
});

test('the transcription gate matches the single gunicorn worker', () => {
  const notes = fs.readFileSync(path.join(__dirname, '../routes/notes.js'), 'utf8');

  assert.match(notes, /numberFromEnv\('MAX_CONCURRENT_TRANSCRIPTIONS', 1\)/);
  assert.doesNotMatch(notes, /numberFromEnv\('MAX_CONCURRENT_TRANSCRIPTIONS', 2\)/);

  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
  const aiDockerfile = fs.readFileSync(path.join(root, 'ai/Dockerfile'), 'utf8');
  assert.match(supervisor, /gunicorn[^\n]*--workers 1/, 'the gate default must match the worker count');
  assert.match(aiDockerfile, /--workers", "1/, 'the gate default must match the worker count');
});
