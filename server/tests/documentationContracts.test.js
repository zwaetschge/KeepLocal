const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

const activeMarkdown = [
  'README.md',
  'AUDIT_REPORT.md',
  'unraid/README.md',
  ...fs.readdirSync(path.join(root, 'docs'))
    .filter(filename => filename.endsWith('.md'))
    .map(filename => `docs/${filename}`),
];

function localTargets(markdown) {
  const targets = [];
  const markdownLink = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  const htmlImage = /<img\s+[^>]*src="([^"]+)"/g;
  let match;

  while ((match = markdownLink.exec(markdown)) !== null) targets.push(match[1]);
  while ((match = htmlImage.exec(markdown)) !== null) targets.push(match[1]);

  return targets
    .map(target => target.trim().replace(/^<|>$/g, '').split('#')[0])
    .filter(target => target && !/^(?:https?:|mailto:)/.test(target));
}

test('active Markdown references only existing local files', () => {
  for (const filename of activeMarkdown) {
    const absolute = path.join(root, filename);
    assert.ok(fs.existsSync(absolute), `${filename} must exist`);

    const markdown = fs.readFileSync(absolute, 'utf8');
    for (const target of localTargets(markdown)) {
      const resolved = path.resolve(path.dirname(absolute), decodeURIComponent(target));
      assert.ok(fs.existsSync(resolved), `${filename} links to missing ${target}`);
    }
  }
});

test('superseded status reports and unsupported Unraid templates stay retired', () => {
  for (const filename of [
    'DOCKER_BUILD.md',
    'IMPROVEMENTS.md',
    'NGINX_PROXY_MANAGER.md',
    'NPM_QUICKSTART.md',
    'REFACTORING.md',
    'SECURITY_ANALYSIS.md',
    'SERVER_REFACTORING.md',
    'TESTING_CACHYOS.md',
    'UNRAID_INSTALLATION.md',
    'unraid/client.xml',
    'unraid/server.xml',
    'unraid/mongodb.xml',
    'unraid/keeplocal-compose.xml',
  ]) {
    assert.equal(fs.existsSync(path.join(root, filename)), false, `${filename} is superseded`);
  }
});

test('canonical Unraid template has safe secrets and both persistent data paths', () => {
  const template = fs.readFileSync(path.join(root, 'unraid-template.xml'), 'utf8');
  const exampleEnvironment = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  assert.match(template, /<Repository>valentin2177\/keeplocal:latest<\/Repository>/);
  assert.match(template, /Target="\/data\/db"/);
  assert.match(template, /Target="\/app\/server\/uploads"/);
  assert.match(template, /Name="JWT Secret"[^>]*Default=""[^>]*Required="true"/);
  assert.match(template, /Target="CLIENT_URL"/);
  assert.match(template, /Target="TRUST_PROXY"[^>]*Default="1"/);
  assert.doesNotMatch(template, /changeme|SESSION_SECRET|REACT_APP_API_URL/);
  assert.match(exampleEnvironment, /^JWT_SECRET=\s*$/m);
  assert.doesNotMatch(exampleEnvironment, /JWT_SECRET=(?:change|example|replace|secret)/i);
});

test('current docs do not teach retired authentication or toolchain contracts', () => {
  const docs = activeMarkdown
    .filter(filename => filename !== 'AUDIT_REPORT.md')
    .map(filename => fs.readFileSync(path.join(root, filename), 'utf8'))
    .join('\n');

  assert.doesNotMatch(docs, /Node\.js 18|react-scripts|SESSION_SECRET|\bcsurf\b/);
  assert.doesNotMatch(docs, /localStorage\.setItem\(['"]token|Authorization:\s*Bearer/);
  assert.doesNotMatch(docs, /\bdocker-compose\s+(?:up|down|build|pull|logs)/);
});
