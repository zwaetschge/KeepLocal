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
  assert.match(serverSource, /mongoose\.connection\.readyState === 1/);
  assert.match(serverSource, /database: databaseReady \? 'connected' : 'disconnected'/);
  assert.match(serverSource, /databaseReady \? 200 : 503/);
});
