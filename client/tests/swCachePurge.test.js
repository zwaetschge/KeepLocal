const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/swCachePurge.mjs')
).href;

// v1.16.0-Review F: Der Service Worker cached /api/notes (SWR) — beim Logout
// auf einem geteilten Gerät müssen diese Caches weg. purgeAppCaches ist bewusst
// mit injizierbarem caches-API gebaut, damit diese Logik ohne Browser läuft.

function fakeCaches(names, failOn = null) {
  const deleted = [];
  return {
    deleted,
    api: {
      keys: async () => [...names],
      delete: async (name) => {
        if (failOn === name) throw new Error('cache delete failed');
        deleted.push(name);
        return true;
      }
    }
  };
}

test('purgeAppCaches löscht nur keeplocal-Caches und zählt sie', async () => {
  const { purgeAppCaches } = await import(moduleUrl);
  const { api, deleted } = fakeCaches([
    'keeplocal-v8',
    'other-site-v1',
    'keeplocal-v9',
    'workbox-precache'
  ]);

  const count = await purgeAppCaches(api);

  assert.equal(count, 2, 'nur die beiden keeplocal-Caches');
  assert.deepEqual(deleted.sort(), ['keeplocal-v8', 'keeplocal-v9']);
});

test('purgeAppCaches übersteht fehlende Cache-API und einzelne Fehler', async () => {
  const { purgeAppCaches } = await import(moduleUrl);

  // Kein caches-Objekt (insecure context / alter Browser): 0, kein Throw.
  assert.equal(await purgeAppCaches(undefined), 0);
  assert.equal(await purgeAppCaches(null), 0);
  assert.equal(await purgeAppCaches({}), 0, 'ohne keys() gibt es nichts zu tun');

  // Ein Löschfehler darf den Logout nie blockieren — Promise.all reißt sonst
  // alles mit, deshalb fängt die Funktion komplett ab.
  const { api } = fakeCaches(['keeplocal-v8'], 'keeplocal-v8');
  assert.equal(await purgeAppCaches(api), 0, 'Fehler → 0 gemeldet, kein Throw');
});

test('AuthContext ruft den Purge im logout auf (Source-Pin)', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    path.join(__dirname, '../src/contexts/AuthContext.jsx'),
    'utf8'
  );
  assert.match(source, /purgeAppCaches\(\)/, 'logout() schlägt im Cache-Speicher zu');
  assert.match(source, /from '..\/utils\/swCachePurge.mjs'/);
});
