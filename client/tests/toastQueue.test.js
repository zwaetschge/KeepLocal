const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// BUG_REPORT_2026-09-10 #4: App.jsx kept a single toast in component state.
// A second notification replaced the first (lost message) and inherited its
// running timer, so the visible toast could disappear after a few hundred
// milliseconds instead of three seconds. The queue host (<ToastStack />) was
// already mounted at the app root but unused by App.
test('App publishes notifications through the toast bus instead of local state', () => {
  const source = read('App.jsx');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

  assert.match(source, /import ToastStack, \{ toastBus \} from '\.\/components\/ToastStack';/);
  assert.match(source, /const showToast = useCallback\(\(message, type = 'info'\) => \{\s*toastBus\.publish\(message, type\);\s*\}, \[\]\);/);
  assert.doesNotMatch(code, /import Toast from '\.\/components\/Toast';/, 'the single-toast component must not be rendered next to the queue');
  assert.doesNotMatch(code, /setToast\(/, 'no local toast state');
  assert.doesNotMatch(code, /toastElement/, 'no separately rendered toast element');
  assert.equal(code.match(/<ToastStack \/>/g)?.length, 1, 'exactly one queue host at the app root');
});

test('the toast queue host keys each toast so timers never carry over', () => {
  const source = read('components', 'ToastStack.jsx');

  assert.match(source, /key=\{toast\.id\}/);
  assert.match(source, /duration=\{toast\.duration\}/);
  assert.match(source, /onClose=\{\(\) => toastBus\.dismiss\(toast\.id\)\}/);
});

// #17: dropping a note on another section toggled the pin (which already toasts)
// and then toasted a second time, hiding the first message.
test('dragging between sections does not double-toast', () => {
  const source = read('hooks', 'useNotesManager.js');
  const dropHandler = source.split('const handleDrop = useCallback')[1].split('// Live-Refresh')[0];

  assert.match(dropHandler, /await togglePinNote\(sourceId\);/);
  assert.doesNotMatch(dropHandler, /noteWasPinned|noteWasUnpinned/);
});

test('the toast bus keeps queued messages instead of replacing them', () => {
  // Behavioural check of the queue the app now relies on.
  const busSource = read('utils', 'toastBus.mjs');
  assert.match(busSource, /toasts = \[\.\.\.toasts, \{ id, message: String\(message\), type, duration \}\]\.slice\(\s*-MAX_VISIBLE_TOASTS\s*\);/);
});
