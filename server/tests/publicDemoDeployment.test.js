const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

test('public demo compose requires an immutable image and isolated data paths', () => {
  const compose = fs.readFileSync(path.join(root, 'docker-compose.demo.yml'), 'utf8');

  assert.match(compose, /image: \$\{KEEPLOCAL_DEMO_IMAGE:\?/);
  assert.doesNotMatch(compose, /image:\s*[^\n]*:latest/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  assert.match(compose, /\/mnt\/user\/appdata\/keeplocal-demo\/mongodb:\/data\/db/);
  assert.match(compose, /\/mnt\/user\/appdata\/keeplocal-demo\/uploads:\/app\/server\/uploads/);
  assert.doesNotMatch(compose, /\/mnt\/user\/appdata\/keeplocal\/(?:mongodb|uploads)/);
  assert.match(compose, /MONGODB_URI: mongodb:\/\/localhost:27017\/keeplocal-demo/);
  assert.match(compose, /brian_traefik-public:\n\s+external: true/);
});

test('public demo is private by default and Traefik exposes only API data paths', () => {
  const compose = fs.readFileSync(path.join(root, 'docker-compose.demo.yml'), 'utf8');
  const rule = compose.match(/traefik\.http\.routers\.keeplocal-demo\.rule: ([^\n]+)/)?.[1] || '';

  assert.match(compose, /traefik\.enable: \$\{TRAEFIK_ENABLE:-false\}/);
  assert.match(rule, /Host\(`keeplocal-demo\.zwaetschge-webui\.ch`\)/);
  assert.match(rule, /Path\(`\/api`\)/);
  assert.match(rule, /PathPrefix\(`\/api\/`\)/);
  assert.match(rule, /Path\(`\/uploads`\)/);
  assert.match(rule, /PathPrefix\(`\/uploads\/`\)/);
  assert.doesNotMatch(rule, /PathPrefix\(`\/`\)/);
  assert.match(compose, /tls\.certresolver: cloudflare/);
  assert.match(compose, /middlewares: security-headers@file/);
  assert.match(compose, /loadbalancer\.server\.port: "80"/);
});

test('public demo compose enables the sandbox without embedding credentials', () => {
  const compose = fs.readFileSync(path.join(root, 'docker-compose.demo.yml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  const runtimeEnvironment = dockerfile.match(/# Environment variables with defaults\nENV ([\s\S]*?)\n\n# Health check/)?.[1] || '';

  assert.match(compose, /JWT_SECRET: \$\{JWT_SECRET:\?/);
  assert.match(compose, /CSRF_SECRET: \$\{CSRF_SECRET:\?/);
  assert.match(compose, /COOKIE_SECURE: "true"/);
  assert.match(compose, /ALLOWED_ORIGINS: https:\/\/keep-local-silk\.vercel\.app/);
  assert.match(compose, /CLIENT_URL: https:\/\/keep-local-silk\.vercel\.app/);
  assert.match(compose, /DEMO_MODE: "true"/);
  assert.match(compose, /DEMO_RESET_INTERVAL_HOURS: \$\{DEMO_RESET_INTERVAL_HOURS:-6\}/);
  assert.match(compose, /DEMO_NOTE_LIMIT: \$\{DEMO_NOTE_LIMIT:-100\}/);

  assert.match(runtimeEnvironment, /DEMO_MODE=false/);
  assert.match(runtimeEnvironment, /DEMO_RESET_INTERVAL_HOURS=6/);
  assert.match(runtimeEnvironment, /DEMO_NOTE_LIMIT=100/);
  assert.doesNotMatch(runtimeEnvironment, /CSRF_SECRET=/);
  assert.doesNotMatch(runtimeEnvironment, /GOOGLE_CLIENT_SECRET=/);
  assert.doesNotMatch(runtimeEnvironment, /GITHUB_CLIENT_SECRET=/);
});
