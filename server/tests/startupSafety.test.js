const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const databaseSource = fs.readFileSync(path.resolve(__dirname, '../config/database.js'), 'utf8');

test('HTTP starts only after MongoDB connects and indexes are ready', () => {
  assert.match(serverSource, /async function startServer\(\)[\s\S]*?await connectDB\(\)[\s\S]*?model\.init\(\)[\s\S]*?app\.listen/);
  assert.match(serverSource, /if \(require\.main === module\)/);
  assert.doesNotMatch(databaseSource, /process\.exit/);
});

test('health endpoint reports database disconnects', () => {
  // Improvement #10: the checks moved into services/healthService.js and go
  // beyond mongoose's cached readyState (real ping, writable uploads, AI probe).
  assert.match(serverSource, /const \{ collectHealth \} = require\('\.\/services\/healthService'\);/);
  assert.match(serverSource, /res\.status\(health\.ready \? 200 : 503\)/);
  assert.match(serverSource, /database: health\.database\.status/);

  const healthSource = fs.readFileSync(path.join(__dirname, '../services/healthService.js'), 'utf8');
  assert.match(healthSource, /mongoose\.connection\.readyState !== 1/);
  assert.match(healthSource, /mongoose\.connection\.db\.admin\(\)\.ping\(\)/);
});

test('server shuts down gracefully on SIGTERM and SIGINT', () => {
  assert.match(serverSource, /process\.on\('SIGTERM'/);
  assert.match(serverSource, /process\.on\('SIGINT'/);
  // Laufende Requests abschließen, DB schließen, aber nie endlos hängen bleiben.
  assert.match(serverSource, /httpServer\.close\(/);
  assert.match(serverSource, /mongoose\.connection\.close\(/);
  assert.match(serverSource, /setTimeout\([\s\S]*?,\s*10000\)/);
});

test('API documentation stays disabled in production unless explicitly enabled', () => {
  // Alle Deployment-Varianten setzen NODE_ENV=production — Swagger darf dort
  // nicht ohne Opt-in exponiert werden.
  assert.match(serverSource, /ENABLE_API_DOCS === 'true'/);
  assert.match(serverSource, /ENABLE_API_DOCS !== 'false' && process\.env\.NODE_ENV !== 'production'/);
  // Beide Dokumentations-Routen müssen innerhalb des Gates liegen.
  const gate = serverSource.match(/const apiDocsEnabled[\s\S]*?\n\}/);
  assert.ok(gate, 'apiDocsEnabled gate must exist');
  assert.match(gate[0], /app\.use\('\/api\/docs', swaggerUi/);
  assert.match(gate[0], /app\.get\('\/api\/docs\.json'/);
});
