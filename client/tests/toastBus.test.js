const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/toastBus.mjs')
).href;

test('toastBus publishes messages and notifies subscribers', async () => {
  const { toastBus } = await import(moduleUrl);
  toastBus.clear();

  const seen = [];
  const unsubscribe = toastBus.subscribe((toasts) => seen.push(toasts.map((t) => t.message)));

  const id = toastBus.publish('Erste Meldung', 'success', 1500);

  assert.ok(Number.isInteger(id));
  assert.deepEqual(seen, [[], ['Erste Meldung']]);
  assert.deepEqual(toastBus.getToasts(), [{
    id,
    message: 'Erste Meldung',
    type: 'success',
    duration: 1500,
  }]);

  unsubscribe();
});

test('toastBus helpers pick the right type and default duration', async () => {
  const { toastBus } = await import(moduleUrl);
  toastBus.clear();

  toastBus.info('info');
  toastBus.success('success');
  toastBus.warning('warning');
  toastBus.error('error');

  const types = toastBus.getToasts().map((toast) => toast.type);
  assert.deepEqual(types, ['info', 'success', 'warning', 'error']);
  for (const toast of toastBus.getToasts()) {
    assert.equal(toast.duration, 3000);
  }
});

test('toastBus dismiss removes a single toast and is a no-op for unknown ids', async () => {
  const { toastBus } = await import(moduleUrl);
  toastBus.clear();

  const first = toastBus.publish('one');
  const second = toastBus.publish('two');

  toastBus.dismiss(first);
  assert.deepEqual(toastBus.getToasts().map((t) => t.message), ['two']);

  const before = toastBus.getToasts();
  toastBus.dismiss(999999);
  assert.equal(toastBus.getToasts(), before, 'no-op dismiss must not emit');

  toastBus.dismiss(second);
  assert.deepEqual(toastBus.getToasts(), []);
});

test('toastBus caps the queue at four toasts (newest win)', async () => {
  const { toastBus } = await import(moduleUrl);
  toastBus.clear();

  for (let i = 1; i <= 6; i++) {
    toastBus.publish(`toast-${i}`);
  }

  assert.deepEqual(
    toastBus.getToasts().map((toast) => toast.message),
    ['toast-3', 'toast-4', 'toast-5', 'toast-6']
  );
});

test('toastBus ignores empty messages', async () => {
  const { toastBus } = await import(moduleUrl);
  toastBus.clear();

  assert.equal(toastBus.publish(''), null);
  assert.equal(toastBus.publish(undefined), null);
  assert.equal(toastBus.publish(null), null);
  assert.deepEqual(toastBus.getToasts(), []);
});

test('ToastStack re-exports the bus and modals mount it', async () => {
  const fs = require('node:fs');

  const stackSource = fs.readFileSync(
    path.join(__dirname, '../src/components/ToastStack.jsx'),
    'utf8'
  );
  assert.match(stackSource, /export \{ toastBus \}/);
  assert.match(stackSource, /from '\.\.\/utils\/toastBus\.mjs'/);

  const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  assert.match(app, /<ToastStack \/>/, 'App.jsx must mount the single toast host');
  for (const file of ['NoteModal.jsx', 'FriendsModal.jsx', 'CollaborateModal.jsx', 'Settings.jsx']) {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/components', file),
      'utf8'
    );
    assert.match(source, /toastBus/, `${file} publishes via toastBus`);
    assert.doesNotMatch(source, /<ToastStack \/>/, `${file} must not mount its own host`);
  }
});
