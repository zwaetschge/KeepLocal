const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../routes/friends.js'), 'utf8');

test('friend acceptance uses idempotent atomic updates instead of document saves', () => {
  assert.match(source, /\$addToSet:\s*\{ friends:/);
  assert.match(source, /\$pull:\s*\{ friendRequests:/);
  assert.doesNotMatch(source, /await requester\.save\(\)/);
});

test('friend routes bound search input and validate path IDs', () => {
  assert.match(source, /trimmedQuery\.length > 100/);
  assert.match(source, /mongoose\.isValidObjectId\(req\.params\.requestId\)/);
  assert.match(source, /mongoose\.isValidObjectId\(req\.params\.friendId\)/);
});
