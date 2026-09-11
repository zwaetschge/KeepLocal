const test = require('node:test');
const assert = require('node:assert/strict');

// Improvement #7: link previews are fetched from the internet on every editor
// open. A 15-minute cache keyed by URL hash removes most of that traffic.

const cacheModelPath = require.resolve('../models/LinkPreviewCache');
const linkPreviewUtilPath = require.resolve('../utils/linkPreview');
const servicePath = require.resolve('../services/linkPreviewService');

function loadService({ stored = null, failRead = false, failWrite = false } = {}) {
  const state = { fetches: [], writes: [], reads: 0 };

  const CacheMock = {
    findOne: (query) => ({
      lean: async () => {
        state.reads += 1;
        if (failRead) throw new Error('cache read exploded');
        return stored && stored.urlHash === query.urlHash ? stored : null;
      }
    }),
    updateOne: async (filter, update) => {
      if (failWrite) throw new Error('cache write exploded');
      state.writes.push({ filter, update });
      return { acknowledged: true };
    }
  };

  for (const p of [servicePath, cacheModelPath, linkPreviewUtilPath]) delete require.cache[p];
  require.cache[cacheModelPath] = { id: cacheModelPath, filename: cacheModelPath, loaded: true, exports: CacheMock };
  require.cache[linkPreviewUtilPath] = {
    id: linkPreviewUtilPath, filename: linkPreviewUtilPath, loaded: true,
    exports: {
      fetchLinkPreview: async (url) => {
        state.fetches.push(url);
        return { url, title: 'Example', description: '', image: '', siteName: 'example.com' };
      }
    }
  };

  return { service: require(servicePath), state };
}

test('a cache miss fetches, stores and reports cached=false', async () => {
  const { service, state } = loadService();

  const result = await service.getLinkPreview('https://example.com/a');

  assert.equal(result.cached, false);
  assert.equal(result.preview.title, 'Example');
  assert.deepEqual(state.fetches, ['https://example.com/a']);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].update.$set.url, 'https://example.com/a');
  assert.ok(state.writes[0].filter.urlHash, 'stored under a URL hash');
  assert.ok(state.writes[0].update.$set.createdAt instanceof Date);
  // upsert so concurrent misses do not race on duplicate keys
  assert.equal(state.writes[0].update.upsert === undefined, true);
});

test('a cache hit never touches the network', async () => {
  const first = loadService();
  const url = 'https://example.com/cached';
  await first.service.getLinkPreview(url);
  const written = first.state.writes[0];

  const second = loadService({
    stored: { urlHash: written.filter.urlHash, url, payload: written.update.$set.payload }
  });
  const result = await second.service.getLinkPreview(url);

  assert.equal(result.cached, true);
  assert.equal(result.preview.siteName, 'example.com');
  assert.deepEqual(second.state.fetches, [], 'no upstream request on a hit');
  assert.deepEqual(second.state.writes, [], 'a hit must not rewrite the cache');
});

test('cache failures degrade to a direct fetch instead of failing the request', async () => {
  const brokenRead = loadService({ failRead: true });
  const fromReadFailure = await brokenRead.service.getLinkPreview('https://example.com/b');
  assert.equal(fromReadFailure.cached, false);
  assert.equal(fromReadFailure.preview.title, 'Example');

  const brokenWrite = loadService({ failWrite: true });
  const fromWriteFailure = await brokenWrite.service.getLinkPreview('https://example.com/c');
  assert.equal(fromWriteFailure.preview.title, 'Example');
  assert.deepEqual(brokenWrite.state.fetches, ['https://example.com/c']);
});

test('upstream errors are not cached', async () => {
  const cacheModelPathLocal = require.resolve('../models/LinkPreviewCache');
  const utilPath = require.resolve('../utils/linkPreview');
  const svcPath = require.resolve('../services/linkPreviewService');
  const writes = [];

  for (const p of [svcPath, cacheModelPathLocal, utilPath]) delete require.cache[p];
  require.cache[cacheModelPathLocal] = {
    id: cacheModelPathLocal, filename: cacheModelPathLocal, loaded: true,
    exports: {
      findOne: () => ({ lean: async () => null }),
      updateOne: async (filter, update) => { writes.push({ filter, update }); return {}; }
    }
  };
  require.cache[utilPath] = {
    id: utilPath, filename: utilPath, loaded: true,
    exports: {
      fetchLinkPreview: async () => {
        const error = new Error('Zielseite antwortete mit HTTP 404');
        error.statusCode = 502;
        throw error;
      }
    }
  };

  const service = require(svcPath);
  await assert.rejects(service.getLinkPreview('https://example.com/missing'), (error) => {
    assert.equal(error.statusCode, 502);
    return true;
  });
  assert.deepEqual(writes, [], 'a failure must not be cached');

  for (const p of [svcPath, cacheModelPathLocal, utilPath]) delete require.cache[p];
});

test('the cache model expires entries after 15 minutes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../models/LinkPreviewCache.js'), 'utf8');

  assert.match(source, /urlHash: \{/);
  assert.match(source, /unique: true/);
  assert.match(source, /expireAfterSeconds: 15 \* 60/);
});
