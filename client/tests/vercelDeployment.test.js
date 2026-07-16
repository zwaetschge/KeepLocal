const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

test('Vercel has an explicit Vite build contract and OAuth callback rewrite', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

  assert.equal(config.framework, 'vite');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'build');
  assert.deepEqual(config.rewrites, [
    { source: '/oauth/callback', destination: '/index.html' },
  ]);
});

test('Vite exposes the legacy API URL without exposing arbitrary environment variables', async () => {
  const configUrl = pathToFileURL(path.join(root, 'vite.config.mjs')).href;
  const { default: config } = await import(configUrl);

  assert.deepEqual(config.envPrefix, ['VITE_', 'REACT_APP_API_URL']);
  assert.ok(!config.envPrefix.includes(''));
});

test('the client prefers VITE_API_URL and falls back to REACT_APP_API_URL', () => {
  const source = fs.readFileSync(path.join(root, 'src/constants/api.js'), 'utf8');
  const viteIndex = source.indexOf('import.meta.env.VITE_API_URL');
  const legacyIndex = source.indexOf('import.meta.env.REACT_APP_API_URL');

  assert.notEqual(viteIndex, -1);
  assert.notEqual(legacyIndex, -1);
  assert.ok(viteIndex < legacyIndex, 'VITE_API_URL must take precedence');
});
