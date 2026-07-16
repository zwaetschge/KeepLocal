const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('all-in-one nginx sends private uploads through backend authorization', () => {
  const config = fs.readFileSync(path.join(root, 'nginx-allinone.conf'), 'utf8');
  const uploads = config.match(/location (?:\^~ )?\/uploads\/\s*\{([\s\S]*?)\n\s*\}/);

  assert.ok(uploads, 'an exact /uploads/ location must exist');
  assert.match(uploads[1], /proxy_pass\s+http:\/\/localhost:5000/);
  assert.doesNotMatch(uploads[1], /alias\s+/);
  assert.match(uploads[1], /Cache-Control\s+"private, no-store"/);
});

test('split nginx proxies uploads and never caches the service worker immutably', () => {
  const config = fs.readFileSync(path.join(root, 'client/nginx.conf'), 'utf8');

  assert.match(config, /location (?:\^~ )?\/uploads\/\s*\{[\s\S]*?proxy_pass\s+http:\/\/server:5000/);
  assert.match(config, /location = \/service-worker\.js\s*\{[\s\S]*?no-cache/);
  assert.match(config, /X-Frame-Options\s+"SAMEORIGIN"/);
  assert.match(config, /X-Content-Type-Options\s+"nosniff"/);
  assert.match(config, /Permissions-Policy\s+/);
  assert.match(config, /Content-Security-Policy\s+"default-src 'self'/);
});

test('all-in-one internal services bind to loopback and production CORS is not wildcarded', () => {
  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.allinone.yml'), 'utf8');

  assert.match(supervisor, /mongod[^\n]*--bind_ip 127\.0\.0\.1/);
  assert.match(supervisor, /gunicorn --bind 127\.0\.0\.1:5001/);
  assert.doesNotMatch(dockerfile, /ALLOWED_ORIGINS=\*/);
  assert.doesNotMatch(compose, /ALLOWED_ORIGINS=\*/);
  assert.match(fs.readFileSync(path.join(root, 'nginx-allinone.conf'), 'utf8'), /Content-Security-Policy\s+"default-src 'self'/);
});

test('split deployments persist the upload directory actually used by the server', () => {
  for (const filename of ['docker-compose.yml', 'docker-compose.npm.yml']) {
    const compose = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(compose, /uploads_data:\/app\/uploads\b/, `${filename} must mount /app/uploads`);
    assert.doesNotMatch(compose, /uploads_data:\/app\/server\/uploads\b/);
  }
});

test('Nginx Proxy Manager deployment includes AI and isolates internal services', () => {
  const compose = fs.readFileSync(path.join(root, 'docker-compose.npm.yml'), 'utf8');

  assert.match(compose, /\n\s{2}ai:\n[\s\S]*?WHISPER_MODEL=/);
  assert.match(compose, /AI_SERVICE_URL=http:\/\/ai:5000/);
  assert.match(compose, /TRUST_PROXY=1/);
  assert.match(compose, /\n\s{2}backend:\n[\s\S]*?internal:\s*true/);
  assert.match(compose, /\n\s{2}frontend:\n/);

  const serverBlock = compose.match(/\n\s{2}server:\n([\s\S]*?)\n\s{2}client:\n/)?.[1] || '';
  const clientBlock = compose.match(/\n\s{2}client:\n([\s\S]*?)\nnetworks:\n/)?.[1] || '';
  assert.doesNotMatch(serverBlock, /- npm-network/);
  assert.match(clientBlock, /- npm-network/);
});

test('all deployment variants pass authentication security settings through', () => {
  for (const filename of ['docker-compose.yml', 'docker-compose.npm.yml', 'docker-compose.allinone.yml']) {
    const compose = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(compose, /CSRF_SECRET=/, `${filename} must pass CSRF_SECRET`);
    assert.match(compose, /COOKIE_SECURE=/, `${filename} must pass COOKIE_SECURE`);
    assert.match(compose, /ALLOWED_ORIGINS=\$\{ALLOWED_ORIGINS:/, `${filename} must make origins configurable`);
  }

  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
  assert.match(supervisor, /CSRF_SECRET="%\(ENV_CSRF_SECRET\)s"/);
  assert.match(supervisor, /COOKIE_SECURE="%\(ENV_COOKIE_SECURE\)s"/);
  assert.match(supervisor, /GOOGLE_CLIENT_ID="%\(ENV_GOOGLE_CLIENT_ID\)s"/);
  assert.match(supervisor, /GITHUB_CLIENT_ID="%\(ENV_GITHUB_CLIENT_ID\)s"/);
});

test('application containers drop root privileges', () => {
  const serverDockerfile = fs.readFileSync(path.join(root, 'server/Dockerfile'), 'utf8');
  const aiDockerfile = fs.readFileSync(path.join(root, 'ai/Dockerfile'), 'utf8');
  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');

  assert.match(serverDockerfile, /\nUSER node\s*\n/);
  assert.match(aiDockerfile, /\nUSER keeplocal\s*\n/);
  assert.match(supervisor, /\[program:ai\][\s\S]*?\nuser=node\n/);
  assert.doesNotMatch(aiDockerfile, /python3\\\n/);
  assert.doesNotMatch(aiDockerfile, /python3-pip\\\n/);
});

test('all-in-one image declares the Whisper model argument in its consuming stage', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  const stages = dockerfile.split(/^FROM /m);
  const clientStage = stages.find((stage) => stage.startsWith('node:22-alpine AS client-builder'));
  const runtimeStage = stages.find((stage) => stage.startsWith('ubuntu:22.04'));

  assert.ok(clientStage, 'client-builder stage should exist');
  assert.ok(runtimeStage, 'Ubuntu runtime stage should exist');
  assert.doesNotMatch(clientStage, /^ARG WHISPER_MODEL=/m);
  assert.match(runtimeStage, /^ARG WHISPER_MODEL=tiny$/m);
  assert.match(runtimeStage, /^ENV WHISPER_MODEL=\$\{WHISPER_MODEL\}/m);
  assert.ok(
    runtimeStage.indexOf('ARG WHISPER_MODEL=tiny')
      < runtimeStage.indexOf('ENV WHISPER_MODEL=${WHISPER_MODEL}'),
    'WHISPER_MODEL must be declared before it is expanded in the runtime stage',
  );
});

test('published all-in-one image is smoke-tested on every built architecture', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-build.yml'), 'utf8');
  const testJob = workflow.match(/\n  test-image:\n([\s\S]*)/)?.[1] || '';

  assert.match(testJob, /architecture:\n\s+- amd64\n\s+- arm64/);
  assert.match(testJob, /uses: docker\/setup-qemu-action@v3/);
  assert.match(testJob, /docker pull[\s\S]*?--platform "linux\/\$\{\{ matrix\.architecture \}\}"/);
  assert.match(testJob, /docker run[\s\S]*?--platform "linux\/\$\{\{ matrix\.architecture \}\}"/);
  assert.match(testJob, /docker exec keeplocal-test curl -f http:\/\/127\.0\.0\.1:5001\/health/);
});

test('Whisper images cache model files without loading CTranslate2 during the build', () => {
  for (const filename of ['Dockerfile.allinone', 'ai/Dockerfile']) {
    const dockerfile = fs.readFileSync(path.join(root, filename), 'utf8');
    const preload = dockerfile.match(/RUN[^\n]*(?:\\\n[^\n]*)*download_model[^\n]*/)?.[0] || '';

    assert.match(preload, /from faster_whisper import download_model/, `${filename} must use download_model`);
    assert.doesNotMatch(preload, /WhisperModel/, `${filename} must not construct a model while cross-building`);
  }
});
