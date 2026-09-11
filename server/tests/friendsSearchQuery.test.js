const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// Regression guard for BUG_REPORT_2026-09-10 #14: `?query=a&query=b` (and
// `?query[]=a`) arrive as an array. The old `(query || '').trim()` threw a
// TypeError, which surfaced as a 500 instead of an empty result.

const userModelPath = require.resolve('../models/User');
const authPath = require.resolve('../middleware/auth');
const routerPath = require.resolve('../routes/friends');

function loadRouter(findResult = []) {
  const calls = [];
  delete require.cache[routerPath];
  delete require.cache[authPath];
  delete require.cache[userModelPath];

  const chainable = {
    select: () => chainable,
    limit: () => chainable,
    populate: () => chainable,
    then: (resolve) => resolve(findResult)
  };

  require.cache[userModelPath] = {
    id: userModelPath, filename: userModelPath, loaded: true,
    exports: {
      find: (query) => { calls.push(query); return chainable; },
      findOne: async () => null,
      findById: async () => ({ friends: [], friendRequests: [] })
    }
  };
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      authenticateToken: (req, _res, next) => {
        req.user = { _id: 'user-id', isAdmin: false, isDemo: false };
        next();
      }
    }
  };
  return { router: require(routerPath), calls };
}

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/friends', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/friends`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const p of [routerPath, authPath, userModelPath]) delete require.cache[p];
  }
}

test('duplicate query parameters answer 200 with an empty result', async () => {
  const { router, calls } = loadRouter([]);

  await withServer(router, async base => {
    const response = await fetch(`${base}/search?query=a&query=b`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, []);
    assert.equal(calls.length, 0, 'an array query must not reach the database layer');
  });
});

test('bracket-style query parameters answer 200 with an empty result', async () => {
  const { router } = loadRouter([]);

  await withServer(router, async base => {
    const response = await fetch(`${base}/search?query[]=a`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});

test('a normal string query is still escaped and searched', async () => {
  const { router, calls } = loadRouter([{ username: 'auditor' }]);

  await withServer(router, async base => {
    const response = await fetch(`${base}/search?query=${encodeURIComponent('aud.*tor')}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [{ username: 'auditor' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].$or[0].username.$regex, 'aud\\.\\*tor', 'regex metacharacters must be escaped');
  });
});

test('an over-long query is rejected with 400', async () => {
  const { router } = loadRouter([]);

  await withServer(router, async base => {
    const response = await fetch(`${base}/search?query=${'a'.repeat(101)}`);
    assert.equal(response.status, 400);
  });
});
