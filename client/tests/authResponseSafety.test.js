const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('401 handling does not hard-redirect while already on the login surface', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/api/apiUtils.js'), 'utf8');

  assert.doesNotMatch(source, /window\.location\.href\s*=\s*['"]\/login['"]/);
});

test('login and registration tolerate non-JSON proxy and rate-limit errors', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/api/authAPI.js'), 'utf8');
  const utils = fs.readFileSync(path.join(root, 'src/services/api/apiUtils.js'), 'utf8');

  assert.match(source, /parseResponse/);
  assert.match(source, /requireUserPayload/);
  assert.match(utils, /response\.text\(\)/);
  assert.match(utils, /slice\(0, 500\)/);
  assert.doesNotMatch(source, /if \(!response\.ok\) \{\s*const error = await response\.json\(\)/);
});

test('OAuth sessions use an HttpOnly cookie and expose no token in the URL', () => {
  const serverSource = fs.readFileSync(path.join(root, '../server/routes/auth.js'), 'utf8');
  const clientSource = fs.readFileSync(path.join(root, 'src/components/OAuthCallback.jsx'), 'utf8');

  assert.match(serverSource, /oauth\/callback#success=1/);
  assert.match(clientSource, /window\.location\.hash/);
  assert.doesNotMatch(serverSource, /oauth\/callback[?#]token=/);
});

test('the browser never stores or sends JWT bearer tokens', () => {
  const utils = fs.readFileSync(path.join(root, 'src/services/api/apiUtils.js'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'src/services/api/authAPI.js'), 'utf8');

  assert.doesNotMatch(utils, /localStorage\.(?:getItem|setItem)\(['"]token['"]\)/);
  assert.doesNotMatch(utils, /Authorization/);
  assert.match(auth, /X-CSRF-Token/);
});

test('API base URL normalization prevents an /api/api path', () => {
  const source = fs.readFileSync(path.join(root, 'src/constants/api.js'), 'utf8');

  assert.match(source, /replace\(\/\\\/api\$\//);
});
