const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

const runDockerMetadata = (overrides = {}) => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeplocal-docker-metadata-'));
  const outputPath = path.join(outputDirectory, 'github-output');
  const sha = '0123456789abcdef0123456789abcdef01234567';

  const result = childProcess.spawnSync(
    'bash',
    [path.join(root, '.github/scripts/docker-metadata.sh')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKERHUB_USERNAME: 'example',
        IMAGE_NAME: 'keeplocal',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF_NAME: 'main',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_REPOSITORY: 'example/KeepLocal',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: sha,
        ...overrides,
      },
    },
  );

  const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  return { ...result, output, sha };
};

test('all-in-one nginx sends private uploads through backend authorization', () => {
  const config = fs.readFileSync(path.join(root, 'nginx-allinone.conf'), 'utf8');
  const uploads = config.match(/location (?:\^~ )?\/uploads\/\s*\{([\s\S]*?)\n\s*\}/);

  assert.ok(uploads, 'an exact /uploads/ location must exist');
  assert.match(uploads[1], /proxy_pass\s+http:\/\/localhost:5000/);
  assert.doesNotMatch(uploads[1], /alias\s+/);
  assert.match(uploads[1], /Cache-Control\s+"private, no-store"/);
});

test('Nginx deployments keep recovery assets and the service worker out of immutable caches', () => {
  for (const filename of ['client/nginx.conf', 'nginx-allinone.conf']) {
    const config = fs.readFileSync(path.join(root, filename), 'utf8');

    assert.match(config, /location = \/service-worker\.js\s*\{[\s\S]*?no-cache/);
    assert.match(config, /location = \/recover\.html\s*\{[\s\S]*?no-store/);
    assert.match(config, /location ~ \^\/recover\\\.\(css\|js\)\$\s*\{[\s\S]*?no-store/);
    assert.match(config, /X-Frame-Options\s+"SAMEORIGIN"/);
    assert.match(config, /X-Content-Type-Options\s+"nosniff"/);
    assert.match(config, /Permissions-Policy\s+/);
    assert.match(config, /Content-Security-Policy\s+"default-src 'self'/);
    assert.match(config, /font-src 'self' data:/);
  }

  const splitConfig = fs.readFileSync(path.join(root, 'client/nginx.conf'), 'utf8');
  assert.match(splitConfig, /location (?:\^~ )?\/uploads\/\s*\{[\s\S]*?proxy_pass\s+http:\/\/server:5000/);
});

test('all-in-one internal services bind to loopback and production CORS is not wildcarded', () => {
  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.allinone.yml'), 'utf8');

  assert.match(supervisor, /mongod[^\n]*--bind_ip 127\.0\.0\.1/);
  assert.match(supervisor, /gunicorn --bind 127\.0\.0\.1:5001/);
  assert.doesNotMatch(dockerfile, /ALLOWED_ORIGINS=\*/);
  assert.doesNotMatch(compose, /ALLOWED_ORIGINS=\*/);
  const nginx = fs.readFileSync(path.join(root, 'nginx-allinone.conf'), 'utf8');
  assert.match(nginx, /Content-Security-Policy\s+"default-src 'self'/);
  assert.match(nginx, /font-src 'self' data:/);
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
  assert.match(compose, /TRUST_PROXY=2/);
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
  assert.doesNotMatch(supervisor, /^environment=/m);
  assert.match(supervisor, /\[program:nodejs\][\s\S]*?command=\/usr\/bin\/node server\.js/);
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
  const buildJob = workflow.match(/\n  build-and-push:\n([\s\S]*?)\n  test-image:\n/)?.[1] || '';
  const testJob = workflow.match(/\n  test-image:\n([\s\S]*)/)?.[1] || '';

  assert.match(workflow, /concurrency:\n\s+group: docker-publish-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: true/);
  assert.match(buildJob, /timeout-minutes: 45/);
  assert.match(buildJob, /run: \.github\/scripts\/docker-metadata\.sh/);
  assert.doesNotMatch(buildJob, /docker\/metadata-action/);
  assert.match(buildJob, /outputs:\n\s+test-tag: \$\{\{ steps\.meta\.outputs\.test-tag \}\}/);
  assert.match(testJob, /architecture:\n\s+- amd64\n\s+- arm64/);
  assert.match(testJob, /uses: docker\/setup-qemu-action@v3/);
  assert.match(testJob, /docker pull[\s\S]*?--platform "linux\/\$\{\{ matrix\.architecture \}\}"/);
  assert.match(testJob, /docker run[\s\S]*?--platform "linux\/\$\{\{ matrix\.architecture \}\}"/);
  assert.match(testJob, /needs\.build-and-push\.outputs\.test-tag/);
  assert.match(testJob, /docker exec keeplocal-test curl -f http:\/\/127\.0\.0\.1:5001\/health/);
});

test('Docker metadata is generated locally for main and semantic-version releases', () => {
  const main = runDockerMetadata();
  assert.equal(main.status, 0, main.stderr);
  assert.match(main.output, /example\/keeplocal:\d{4}-\d{2}-\d{2}-0123456/);
  assert.match(main.output, /example\/keeplocal:main/);
  assert.match(main.output, /example\/keeplocal:latest/);
  assert.match(main.output, new RegExp(`org\\.opencontainers\\.image\\.revision=${main.sha}`));
  assert.match(main.output, /test-tag=\d{4}-\d{2}-\d{2}-0123456/);

  const release = runDockerMetadata({
    GITHUB_REF_NAME: 'v2.3.4',
    GITHUB_REF_TYPE: 'tag',
  });
  assert.equal(release.status, 0, release.stderr);
  assert.match(release.output, /example\/keeplocal:2\.3\.4/);
  assert.match(release.output, /example\/keeplocal:2\.3\n/);
  assert.match(release.output, /example\/keeplocal:2\n/);
  assert.match(release.output, /example\/keeplocal:latest/);

  const prerelease = runDockerMetadata({
    GITHUB_REF_NAME: 'v2.3.4-rc.1',
    GITHUB_REF_TYPE: 'tag',
  });
  assert.equal(prerelease.status, 0, prerelease.stderr);
  assert.match(prerelease.output, /example\/keeplocal:2\.3\.4-rc\.1/);
  assert.doesNotMatch(prerelease.output, /example\/keeplocal:2\.3\n/);
  assert.doesNotMatch(prerelease.output, /example\/keeplocal:2\n/);
  assert.doesNotMatch(prerelease.output, /example\/keeplocal:latest/);

  const buildMetadata = runDockerMetadata({
    GITHUB_REF_NAME: 'v2.3.4+build.5',
    GITHUB_REF_TYPE: 'tag',
  });
  assert.equal(buildMetadata.status, 0, buildMetadata.stderr);
  assert.match(buildMetadata.output, /example\/keeplocal:2\.3\.4/);
  assert.match(buildMetadata.output, /org\.opencontainers\.image\.version=2\.3\.4/);
  assert.doesNotMatch(buildMetadata.output, /example\/keeplocal:2\.3\.4-build\.5/);
  assert.doesNotMatch(buildMetadata.output, /example\/keeplocal:2\.3\.4\+build\.5/);
});

test('Docker metadata rejects invalid manually supplied release tags', () => {
  const invalid = runDockerMetadata({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    INPUT_VERSION: 'latest;echo-pwned',
  });

  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid semantic version/);
  assert.equal(invalid.output, '');

  for (const version of ['v01.2.3', 'v1.2.3-01']) {
    const leadingZero = runDockerMetadata({
      GITHUB_REF_NAME: version,
      GITHUB_REF_TYPE: 'tag',
    });
    assert.notEqual(leadingZero.status, 0);
    assert.match(leadingZero.stderr, /Invalid semantic version/);
    assert.equal(leadingZero.output, '');
  }

  const nonMainRelease = runDockerMetadata({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF_NAME: 'feature/unreviewed-release',
    INPUT_VERSION: 'v9.9.9',
  });

  assert.notEqual(nonMainRelease.status, 0);
  assert.match(nonMainRelease.stderr, /must be dispatched from the main branch/);
  assert.equal(nonMainRelease.output, '');
});

test('Whisper images cache model files without loading CTranslate2 during the build', () => {
  for (const filename of ['Dockerfile.allinone', 'ai/Dockerfile']) {
    const dockerfile = fs.readFileSync(path.join(root, filename), 'utf8');
    const preload = dockerfile.match(/RUN[^\n]*(?:\\\n[^\n]*)*download_model[^\n]*/)?.[0] || '';

    assert.match(preload, /from faster_whisper import download_model/, `${filename} must use download_model`);
    assert.doesNotMatch(preload, /WhisperModel/, `${filename} must not construct a model while cross-building`);
  }
});
