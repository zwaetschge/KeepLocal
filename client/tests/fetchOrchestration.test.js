const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Audit 2026-09-12 (Top-30 Nr. 15): Kein Request im Client war abbrechbar und
// keiner hatte ein Timeout. `loading`/`refreshing` werden nur im `finally` des
// neuesten Requests geräumt — bei einer halboffenen Verbindung blieb die Liste
// dauerhaft gedimmt bzw. im Skeleton, ohne Fehlermeldung und ohne Retry.
// Filterwechsel stapelten Requests statt sie abzulösen, der Papierkorb-Zähler
// blieb stehen, und ein Drop wurde vom in-flight Poll zurücksortiert.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const signalsUrl = pathToFileURL(path.join(__dirname, '../src/utils/requestSignals.mjs')).href;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the timeout fires and marks the abort as REQUEST_TIMEOUT', async () => {
  const { createRequestSignal, isAbortError, abortCode } = await import(signalsUrl);
  const request = createRequestSignal({ timeoutMs: 20 });

  assert.equal(request.signal.aborted, false);
  await sleep(60);
  assert.equal(request.signal.aborted, true, 'the controller aborts itself');
  assert.equal(request.timedOut(), true);
  assert.equal(abortCode(new Error('aborted'), { timedOut: request.timedOut() }), 'REQUEST_TIMEOUT');
  request.cleanup();
  assert.ok(isAbortError(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
});

test('an external signal (filter change) aborts the request immediately', async () => {
  const { createRequestSignal, isAbortError, abortCode } = await import(signalsUrl);
  const external = new AbortController();
  const request = createRequestSignal({ timeoutMs: 5000, signal: external.signal });

  external.abort('ABORTED');
  assert.equal(request.signal.aborted, true);
  assert.equal(request.timedOut(), false, 'not a timeout — the caller replaced the request');
  assert.equal(abortCode(new Error('aborted'), { timedOut: request.timedOut() }), 'ABORTED');
  assert.ok(isAbortError({ code: 'ABORTED' }));
  request.cleanup();
});

test('an already aborted external signal is honoured before the request starts', async () => {
  const { createRequestSignal } = await import(signalsUrl);
  const external = new AbortController();
  external.abort();
  const request = createRequestSignal({ timeoutMs: 5000, signal: external.signal });
  assert.equal(request.signal.aborted, true);
  request.cleanup();
});

test('cleanup stops the timer so a finished request cannot abort later', async () => {
  const { createRequestSignal } = await import(signalsUrl);
  const request = createRequestSignal({ timeoutMs: 20 });
  request.cleanup();
  await sleep(60);
  assert.equal(request.signal.aborted, false, 'cleanup must clear the timeout');
});

test('the defaults keep slow uploads alive but hang no list request', async () => {
  const { DEFAULT_REQUEST_TIMEOUT_MS, LONG_REQUEST_TIMEOUT_MS } = await import(signalsUrl);
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 20000);
  assert.equal(LONG_REQUEST_TIMEOUT_MS, 330000, 'above nginx proxy_read_timeout 300s and the 300s axios call');
});

test('fetchWithAuth passes the signal through and codes aborts', () => {
  const apiUtils = read('services', 'api', 'apiUtils.js');

  assert.match(apiUtils, /import \{ createRequestSignal, isAbortError \} from '\.\.\/\.\.\/utils\/requestSignals\.mjs';/);
  assert.match(apiUtils, /const \{ signal: externalSignal, timeoutMs, \.\.\.fetchOptions \} = options;/);
  assert.match(apiUtils, /const \{ signal, cleanup, timedOut \} = createRequestSignal\(\{ timeoutMs, signal: externalSignal \}\);/);
  assert.match(apiUtils, /credentials: 'include',\n\s+signal,/, 'fetch must actually receive the signal');
  assert.match(apiUtils, /const code = timedOut\(\) \? 'REQUEST_TIMEOUT' : 'ABORTED';/);
  assert.match(apiUtils, /abortError\.code = code;/);
  assert.match(apiUtils, /\} finally \{\n\s+cleanup\(\);/, 'the timer is always released');
});

test('the notes list aborts the previous request instead of stacking them', () => {
  const hook = read('hooks', 'useNotesManager.js');

  assert.match(hook, /const fetchAbortRef = useRef\(null\);/);
  assert.match(hook, /if \(fetchAbortRef\.current\) fetchAbortRef\.current\.abort\('ABORTED'\);/);
  assert.match(hook, /const controller = new AbortController\(\);\n\s+fetchAbortRef\.current = controller;/);
  assert.match(hook, /await api\.getAll\(params, \{ signal: controller\.signal \}\)/);
  assert.match(hook, /if \(error\?\.code === 'ABORTED'\) return;/, 'a replaced request must not raise an error toast');
  assert.match(hook, /if \(fetchAbortRef\.current === controller\) fetchAbortRef\.current = null;/);

  const notesAPI = read('services', 'api', 'notesAPI.js');
  assert.match(notesAPI, /getAll: \(params = \{\}, options = \{\}\) =>/);
  assert.match(notesAPI, /\{ signal: options\.signal \}/);
  assert.match(notesAPI, /getById: \(id, options = \{\}\) => fetchWithAuth\(API_ENDPOINTS\.NOTES\.BY_ID\(id\), \{ signal: options\.signal \}\)/);
});

test('the trash badge is part of the merge comparison', () => {
  const hook = read('hooks', 'useNotesManager.js');
  assert.match(hook, /plainObjectsEqual\(safeCurrent\.counts, safeIncoming\.counts, \['active', 'archived', 'trash'\]\)/);
});

test('a drop invalidates in-flight fetches before persisting the order', () => {
  const hook = read('hooks', 'useNotesManager.js');
  const dropBody = hook.slice(hook.indexOf('// Innerhalb derselben Sektion umsortieren'));
  const invalidateAt = dropBody.indexOf('invalidateInFlightFetches();');
  const reorderAt = dropBody.indexOf('await api.reorder(orderedIds);');

  assert.ok(invalidateAt > -1 && reorderAt > -1, 'both steps must exist');
  assert.ok(invalidateAt < reorderAt,
    'a poll answer landing between drop and persist would sort the note back visibly');
});

test('transport codes are part of the shared vocabulary and translated', () => {
  const { ALL_CODES, TRANSPORT_CODES } = require('../../server/constants/errorCodes');
  for (const code of ['OFFLINE', 'REQUEST_TIMEOUT', 'ABORTED']) {
    assert.ok(TRANSPORT_CODES.includes(code), `${code} must be declared as a transport code`);
    assert.ok(ALL_CODES.includes(code), `${code} must be part of ALL_CODES`);
  }

  const apiErrors = read('utils', 'apiErrors.mjs');
  for (const [code, key] of [['OFFLINE', 'errOffline'], ['REQUEST_TIMEOUT', 'errRequestTimeout'], ['ABORTED', 'errRequestAborted']]) {
    assert.match(apiErrors, new RegExp(`${code}: '${key}'`));
    for (const file of ['de.js', 'en.js']) {
      assert.match(read('translations', file), new RegExp(`${key}:`), `${file} must translate ${code}`);
    }
  }
});
