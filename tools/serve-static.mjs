#!/usr/bin/env node
/**
 * Minimal static server for the production client build with an API proxy.
 *
 * Used by the Playwright smoke tests (and handy locally) to serve
 * `client/build` exactly like nginx would: SPA fallback to index.html,
 * fingerprinted assets from disk, and `/api` + `/uploads` proxied to the
 * Express server so the built bundle can use same-origin requests
 * (`import.meta.env.PROD` makes API_BASE_URL empty).
 *
 * Env:
 *   PORT          listen port (default 4173)
 *   HOST          bind address (default 127.0.0.1)
 *   UPSTREAM      API origin (default http://127.0.0.1:5000)
 *   PROD_ROOT     build directory (default <repo>/client/build)
 *   SERVE_SW      set to "1" to serve service-worker.js instead of 404ing it
 *                 (tests run without a service worker by default so caching
 *                 cannot mask a broken bundle)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:5000';
const ROOT = process.env.PROD_ROOT ? path.resolve(process.env.PROD_ROOT) : path.join(repoRoot, 'client/build');
const SERVE_SW = process.env.SERVE_SW === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

function proxy(req, res) {
  const target = new URL(req.url, UPSTREAM);
  const headers = { ...req.headers, host: target.host };
  // Keep the upstream response uncompressed so tests can read bodies directly.
  delete headers['accept-encoding'];
  const upstream = http.request(target, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', error: `upstream error: ${error.message}` }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) {
    return proxy(req, res);
  }
  if (pathname === '/service-worker.js' && !SERVE_SW) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('service worker disabled for tests');
  }

  let file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const indexInDir = path.join(file, 'index.html');
    file = fs.existsSync(indexInDir) ? indexInDir : path.join(ROOT, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end(`missing build output: ${file} (run "npm run build" in client/)`);
  }

  const isHtml = file.endsWith('.html');
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    // Same policy as the nginx configs for HTML: never cache the shell.
    'cache-control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-static] http://${HOST}:${PORT} -> ${UPSTREAM} (root ${ROOT})`);
});
