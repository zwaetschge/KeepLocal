const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

test('Vercel has an explicit Vite build contract and same-origin demo proxy', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

  assert.equal(config.framework, 'vite');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'build');
  assert.deepEqual(config.rewrites, [
    {
      source: '/api/:path*',
      destination: 'https://keeplocal-demo.zwaetschge-webui.ch/api/:path*',
    },
    {
      source: '/uploads/:path*',
      destination: 'https://keeplocal-demo.zwaetschge-webui.ch/uploads/:path*',
    },
    { source: '/oauth/callback', destination: '/index.html' },
  ]);
});

test('Vercel applies static security headers and never caches private demo data', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const globalHeaders = config.headers.find(({ source }) => source === '/(.*)')?.headers || [];
  const asMap = (headers) => Object.fromEntries(headers.map(({ key, value }) => [key, value]));
  const security = asMap(globalHeaders);

  assert.match(security['Content-Security-Policy'], /default-src 'self'/);
  assert.match(security['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(security['Content-Security-Policy'], /frame-ancestors 'self'/);
  assert.equal(security['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(security['X-Content-Type-Options'], 'nosniff');
  assert.equal(security['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(security['Permissions-Policy'], 'camera=(), microphone=(self), geolocation=()');

  for (const source of ['/api/:path*', '/uploads/:path*']) {
    const privateHeaders = config.headers.find((entry) => entry.source === source)?.headers || [];
    assert.match(asMap(privateHeaders)['Cache-Control'], /\bno-store\b/);
  }
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
