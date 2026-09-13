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
    assert.match(config, /location ~ \^\/\(recover\\\.\(css\|js\)\|guard\\\.js\)\$\s*\{[\s\S]*?no-store/);
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

test('every long-running all-in-one log stream is size-capped', () => {
  const supervisor = fs.readFileSync(path.join(root, 'supervisord.conf'), 'utf8');

  // mongod ohne --logpath loggt auf stdout — sonst wächst die Datei im
  // Container unbegrenzt (mongod rotiert nur auf Signal).
  assert.doesNotMatch(supervisor, /--logpath/);

  const programs = supervisor.match(/\[program:[a-z-]+\]/g) || [];
  assert.equal(programs.length, 5, 'mongodb, ai, demo-reset, nodejs, nginx');
  for (const stream of ['stdout_logfile_maxbytes', 'stderr_logfile_maxbytes']) {
    const caps = supervisor.match(new RegExp(`${stream}=\\d+`, 'g')) || [];
    // 5 Programme + der Eventlistener (stderr → /dev/stderr, maxbytes=0).
    assert.ok(caps.length >= programs.length, `every program must cap ${stream}`);
    assert.ok(caps.every(cap => /=\d+$/.test(cap)), `${stream} must stay numeric (=0 means: the log driver rotates)`);
  }
  assert.match(supervisor, /logfile_maxbytes=\d+MB/);
});

test('CI runs the full test, lint and build suites before images are published', () => {
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

  assert.match(ci, /on:\n\s+push:\n\s+branches: \[main\]\n\s+pull_request:/);
  for (const job of ['server:', 'client:']) {
    assert.match(ci, new RegExp(`\\n  ${job}\\n`), `CI must define a ${job} job`);
  }
  // Beide Jobs müssen echte Installations- und Test-Schritte haben.
  assert.match(ci, /server[\s\S]*?run: npm ci\n[\s\S]*?run: npm test/);
  assert.match(ci, /client[\s\S]*?run: npm ci\n[\s\S]*?run: npm test\n[\s\S]*?run: npm run lint\n[\s\S]*?run: npm run build/);
  assert.match(ci, /uses: actions\/setup-node@v4/);
});

test('CI blocks known high advisories in both dependency trees', () => {
  // Audit 2026-09-12 (Top-30 Nr. 4): 5 High-Advisories im Server-Tree (multer und
  // sharp direkt im Upload-Pfad) blieben monatelang unbemerkt, weil CI nie
  // auditierte. `npm audit --audit-level=high` ist jetzt ein Build-Schritt.
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const serverJob = ci.match(/\n  server:\n([\s\S]*?)\n  client:\n/)?.[1] || '';
  const clientJob = ci.match(/\n  client:\n([\s\S]*?)\n  e2e:\n/)?.[1] || '';

  assert.match(serverJob, /name: Audit dependencies\n\s+working-directory: server\n\s+run: npm audit --audit-level=high/);
  assert.match(clientJob, /name: Audit dependencies\n\s+working-directory: client\n\s+run: npm audit --audit-level=high/);

  // Der Upload-Pfad braucht die gefixten Versionen, nicht nur einen grünen Job.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
  assert.match(pkg.dependencies.multer, /^\^2\.(?:[3-9]|\d{2,})/, 'multer must stay at or above 2.3.0');
  assert.match(pkg.dependencies.sharp, /^\^0\.(?:3[5-9]|\d{3,})/, 'sharp must stay at or above 0.35.4');
  assert.equal(pkg.overrides.qs, '^6.16.0', 'express pins a vulnerable qs without the override');
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
  // Nr. 29: Mit dem ai-builder gibt es zwei ubuntu:22.04-Stages — der Laufzeit-
  // Stage ist der letzte.
  const runtimeStage = stages.filter((stage) => stage.startsWith('ubuntu:22.04')).pop();

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

test('all-in-one runtime image carries no build toolchain (Top-30 Nr. 29)', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  const stages = dockerfile.split(/^FROM /m);
  // Kommentare ignorieren: die Stage-Dokumentation nennt die Pakete, die dort
  // gerade NICHT mehr installiert werden.
  const commands = (stage) => stage
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  const aiBuilder = stages.find((stage) => stage.startsWith('ubuntu:22.04 AS ai-builder'));
  const runtimeStage = stages.filter((stage) => stage.startsWith('ubuntu:22.04')).pop();
  const runtimeCommands = commands(runtimeStage);

  assert.ok(aiBuilder, 'ai-builder stage should exist');
  assert.ok(runtimeStage, 'Ubuntu runtime stage should exist');

  // Compile-Toolchain und -Header nur im Builder-Stage.
  for (const buildDependency of [
    'build-essential',
    'python3-dev',
    'pkg-config',
    'libavcodec-dev',
    'libavformat-dev',
    'libavutil-dev',
    'libswscale-dev',
    'libswresample-dev',
    'libavdevice-dev',
  ]) {
    assert.match(commands(aiBuilder), new RegExp(`\\b${buildDependency}\\b`), `ai-builder must install ${buildDependency}`);
    assert.doesNotMatch(runtimeCommands, new RegExp(`\\b${buildDependency}\\b`), `${buildDependency} must stay in the ai-builder stage`);
  }

  // Laufzeit-Pakete bleiben: python3 + ffmpeg (libav-Runtimes für notgedrungen
  // kompilierte Wheels) und mongodb-org-server — mongosh (287 MB) und mongos
  // (130 MB) aus dem mongodb-org-Metapaket werden im Single-Node-Container
  // nie aufgerufen. gnupg wird im selben RUN wieder entfernt, damit der
  // Key-Import kein eigenes Layer-Duplikat hinterlässt.
  assert.match(runtimeCommands, /apt-get install -y --no-install-recommends mongodb-org-server/);
  assert.doesNotMatch(runtimeCommands, /install -y --no-install-recommends mongodb-org\s*\\/);
  assert.match(runtimeCommands, /apt-get update[\s\S]*\bpython3\b[\s\S]*\bffmpeg\b[\s\S]*\bmongodb-org-server\b[\s\S]*\bnodejs\b/);
  assert.match(runtimeCommands, /\bnodejs\b[\s\S]*apt-get purge -y gnupg[\s\S]*apt-get autoremove[\s\S]*rm -rf \/var\/lib\/apt\/lists\/\*/);

  // Wheels kommen aus dem Builder — das Final-Image installiert kein pip-Paket.
  // Debian/Ubuntu pip benutzt das posix_local-Schema: --prefix=/install legt
  // den Payload unter /install/local ab (Replik des /usr/local-Baums). Der
  // Builder testet die Lage, der Whisper-Preload direkt nach dem COPY
  // verifiziert den Import im selben Build.
  assert.match(runtimeCommands, /COPY --from=ai-builder \/install\/local \/usr\/local/);
  assert.doesNotMatch(runtimeCommands, /pip3 install -r/);
  assert.match(commands(aiBuilder), /test -d \/install\/local\/lib\/python3\.10\/dist-packages/);
  assert.match(commands(aiBuilder), /test -x \/install\/local\/bin\/gunicorn/);

  // Cache-Ordnung: Abhängigkeiten vor dem Quellcode, sonst baut jede
  // ai-Änderung 469 MB Python-Deps bzw. jede Server-Änderung npm ci neu.
  assert.ok(
    aiBuilder.indexOf('COPY ai/requirements.txt') < aiBuilder.indexOf('-r requirements.txt'),
    'ai/requirements.txt must be copied before pip installs it',
  );
  assert.ok(
    runtimeCommands.indexOf('server/package*.json') < runtimeCommands.indexOf('npm ci'),
    'server/package*.json must be copied before npm ci',
  );

  // npm ci und pip-Install laufen als unprivilegierter Nutzer bzw. im Builder;
  // node_modules/ai-Quellen brauchen dadurch kein eigenes chown-Layer (77,5 MB
  // Duplikat im alten Image).
  assert.match(runtimeCommands, /su -s \/bin\/sh node -c "npm ci --omit=dev/);
  assert.match(runtimeCommands, /COPY --chown=node:node server\/ \.\//);
  assert.match(runtimeCommands, /COPY --from=client-builder --chown=node:node/);
  assert.doesNotMatch(runtimeCommands, /chown -R node:node \/app\/server(?!\/uploads)/);
  assert.doesNotMatch(runtimeCommands, /chown -R node:node \/app\/ai\b/);
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
  // Der Build-Kontext ist die zweite Hälfte der Wahrheit: Das Image wird auch
  // dann geprüft, wenn jemand lokal mit Host-node_modules oder einer .env baut.
  assert.match(testJob, /no host artifacts are baked into the image/);
  // Drittpakete liefern eigene *.test.js mit (fast-uri u. a.) - ohne Prune
  // wird der Check zum False Positive und blockiert jeden Publish.
  assert.match(testJob, /find \/app -path "\*\/node_modules" -prune/);
});

test('dockerignore patterns reach into subdirectories', () => {
  // Docker matcht .dockerignore-Muster gegen den Pfad relativ zur Kontext-Wurzel:
  // `node_modules` erfasst NUR ./node_modules, nicht ./server/node_modules.
  // Folgen im lokalen Build: `COPY client/ ./` läuft nach `npm ci` und
  // überschreibt den frischen Tree mit dem Host-Stand; `server/.env` und lokale
  // Test-Uploads landen im Image.
  const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  const patterns = ignore.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

  for (const pattern of ['**/node_modules', '**/.env', '**/.env.local', '**/.env.production', '**/__pycache__']) {
    assert.ok(patterns.includes(pattern), `${pattern} must be depth-anchored`);
  }
  for (const bare of ['node_modules', '.env', '__pycache__']) {
    assert.ok(!patterns.includes(bare), `a bare ${bare} pattern only matches the context root`);
  }
  // Uploads: Inhalt raus, Verzeichnisstruktur (gitkeep) bleibt erhalten.
  assert.ok(patterns.includes('**/uploads/images/*'), 'user uploads must not enter the build context');
  assert.ok(patterns.indexOf('!server/uploads/images/.gitkeep') > patterns.indexOf('**/uploads/images/*'),
    'the gitkeep exception must come after the pattern it overrides (last match wins)');

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.allinone'), 'utf8');
  assert.doesNotMatch(dockerfile, /COPY[^\n]*\.env/, 'the image must never copy an env file explicitly');
  assert.doesNotMatch(dockerfile, /COPY[^\n]*node_modules/, 'node_modules must be installed, never copied');
});

test('images are published only after CI is green for the same commit', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-build.yml'), 'utf8');

  // Kein push-Trigger auf main mehr: sonst laeuft die Bild-Publikation parallel
  // zur CI und ein roter Test haelt `latest` nicht auf.
  assert.doesNotMatch(workflow, /on:[\s\S]*?\n  push:\n\s+branches:/);
  assert.match(workflow, /workflow_run:\n\s+workflows: \["CI"\]\n\s+types:\n\s+- completed\n\s+branches:\n\s+- main/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);

  // Release-Tags und manuelle Releases bleiben direkt moeglich (fuer Tags laeuft
  // keine CI).
  assert.match(workflow, /push:\n\s+tags:\n\s+- 'v\*\.\*\.\*'/);
  assert.match(workflow, /workflow_dispatch:/);

  // Gebaut und gelabelt werden muss der Commit, den die CI geprueft hat -
  // github.sha zeigt bei workflow_run auf den Default-Branch-Stand.
  assert.match(workflow, /ref: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| github\.ref \}\}/);
  assert.match(workflow, /GITHUB_SHA: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
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

test('Docker metadata allows dispatched branch verification builds without touching main or latest', () => {
  // Top-30 Nr. 29: Dockerfile-Änderungen brauchen vor dem Merge einen echten
  // Multi-Arch-Build auf dem Branch. Der darf publishen — aber nur den
  // immutablen Tag, niemals die Rollback-Kanäle der Self-Hoster.
  const branchVerification = runDockerMetadata({
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF_NAME: 'fix/29-image-size',
  });

  assert.equal(branchVerification.status, 0, branchVerification.stderr);
  assert.match(branchVerification.output, /example\/keeplocal:\d{4}-\d{2}-\d{2}-0123456/);
  assert.match(branchVerification.output, /test-tag=\d{4}-\d{2}-\d{2}-0123456/);
  assert.match(branchVerification.output, new RegExp(`org\\.opencontainers\\.image\\.revision=${branchVerification.sha}`));
  assert.doesNotMatch(branchVerification.output, /example\/keeplocal:main/);
  assert.doesNotMatch(branchVerification.output, /example\/keeplocal:latest/);

  // Alle anderen Events auf einem Branch bleiben verboten — nur der manuelle
  // Dispatch ist der Verifikationsweg.
  const branchPush = runDockerMetadata({
    GITHUB_REF_NAME: 'fix/29-image-size',
  });

  assert.notEqual(branchPush.status, 0);
  assert.match(branchPush.stderr, /Refusing to publish an unconfigured branch/);
  assert.equal(branchPush.output, '');
});

test('Whisper images cache model files without loading CTranslate2 during the build', () => {
  for (const filename of ['Dockerfile.allinone', 'ai/Dockerfile']) {
    const dockerfile = fs.readFileSync(path.join(root, filename), 'utf8');
    const preload = dockerfile.match(/RUN[^\n]*(?:\\\n[^\n]*)*download_model[^\n]*/)?.[0] || '';

    assert.match(preload, /from faster_whisper import download_model/, `${filename} must use download_model`);
    assert.doesNotMatch(preload, /WhisperModel/, `${filename} must not construct a model while cross-building`);
  }
});

test('the published image is driven by a real browser, not by four curls', () => {
  // Audit 2026-09-12 (Top-30 Nr. 22): `test-image` war `sleep 45` plus vier
  // Curls. Die Playwright-Suite lief nur gegen den Source-Build — nginx
  // (Routing, CSP, Body-Size, /uploads-Proxy), supervisord, der
  // All-in-One-Start und das gebaute Bundle im Image blieben ungeprüft.
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/docker-build.yml'), 'utf8');
  const testJob = workflow.match(/\n  test-image:\n([\s\S]*)/)?.[1] || '';

  assert.match(testJob, /name: Install Playwright Chromium \(amd64 only\)/);
  assert.match(testJob, /npx playwright install --with-deps chromium/);
  assert.match(testJob, /name: Run the smoke suite against the published image/);
  assert.match(testJob, /run: npm run test:e2e:image/);
  assert.match(testJob, /IMAGE_BASE_URL: http:\/\/localhost:3000/);
  assert.match(testJob, /if: matrix\.architecture == 'amd64'/, 'Chromium under qemu arm64 is too slow and flaky');
  assert.match(testJob, /name: Upload image smoke report/);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'client/package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:e2e:image'], 'playwright test --config playwright.image.config.mjs');

  const imageConfig = fs.readFileSync(path.join(root, 'client/playwright.image.config.mjs'), 'utf8');
  assert.match(imageConfig, /testMatch: 'image-smoke\.spec\.mjs'/);
  assert.doesNotMatch(imageConfig, /webServer/, 'the image under test is already running');
  assert.match(imageConfig, /video: 'off'/, 'a missing ffmpeg must not mask the real failure');

  // Die normale Suite darf die Image-Spec nicht mitladen (sie erwartet einen
  // frischen Setup-Wizard und einen laufenden Container).
  const mainConfig = fs.readFileSync(path.join(root, 'client/playwright.config.mjs'), 'utf8');
  assert.match(mainConfig, /testIgnore: 'image-smoke\.spec\.mjs'/);

  const spec = fs.readFileSync(path.join(root, 'client/e2e/image-smoke.spec.mjs'), 'utf8');
  for (const covered of ['api/health/ready', '#confirmPassword', 'note-content', '#image-upload-input',
    'search-input', 'delete-btn', 'toast-action']) {
    assert.ok(spec.includes(covered), `the image suite must cover ${covered}`);
  }
  assert.match(spec, /expect\(JSON\.stringify\(body\)\)\.not\.toContain\('\/app\/server\/uploads'\)/,
    'production readiness must stay trimmed inside the image too');
});
