const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/modalA11y.mjs')
).href;

function fakeElement(name, { visible = true } = {}) {
  return {
    name,
    getClientRects: visible ? () => [{}] : () => [],
  };
}

test('computeTrapFocus wraps Tab from the last element to the first', async () => {
  const { computeTrapFocus } = await import(moduleUrl);

  const first = fakeElement('first');
  const middle = fakeElement('middle');
  const last = fakeElement('last');
  const focusables = [first, middle, last];

  assert.equal(computeTrapFocus(last, focusables, false), first);
});

test('computeTrapFocus wraps Shift+Tab from the first element to the last', async () => {
  const { computeTrapFocus } = await import(moduleUrl);

  const first = fakeElement('first');
  const middle = fakeElement('middle');
  const last = fakeElement('last');
  const focusables = [first, middle, last];

  assert.equal(computeTrapFocus(first, focusables, true), last);
});

test('computeTrapFocus leaves middle elements to the browser', async () => {
  const { computeTrapFocus } = await import(moduleUrl);

  const first = fakeElement('first');
  const middle = fakeElement('middle');
  const last = fakeElement('last');
  const focusables = [first, middle, last];

  assert.equal(computeTrapFocus(middle, focusables, false), null);
  assert.equal(computeTrapFocus(middle, focusables, true), null);
});

test('computeTrapFocus handles edges and degenerate cases', async () => {
  const { computeTrapFocus } = await import(moduleUrl);

  const only = fakeElement('only');
  assert.equal(computeTrapFocus(only, [only], false), only, 'single element wraps to itself');
  assert.equal(computeTrapFocus(only, [only], true), only);

  assert.equal(computeTrapFocus(only, [], false), null, 'empty list: default behaviour');
  assert.equal(computeTrapFocus(null, null, false), null, 'null input: default behaviour');

  const outside = fakeElement('outside');
  const first = fakeElement('first');
  const last = fakeElement('last');
  // Focus already escaped the dialog: Tab continues by browser default.
  assert.equal(computeTrapFocus(outside, [first, last], false), null);
});

test('getFocusableElements filters by selector, disabled state and visibility', async () => {
  const { getFocusableElements } = await import(moduleUrl);

  const button = fakeElement('button');
  const link = fakeElement('link');
  const hiddenButton = fakeElement('hiddenButton', { visible: false });
  const span = fakeElement('span');

  const container = {
    querySelectorAll(selector) {
      assert.match(selector, /button:not\(\[disabled\]\)/);
      assert.match(selector, /input:not\(\[disabled\]\)/);
      assert.match(selector, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
      // Rough fake of what the selector would match in a real DOM.
      return [button, link, hiddenButton, span].filter((el) => el !== span);
    },
  };

  assert.deepEqual(getFocusableElements(container), [button, link]);
  assert.deepEqual(getFocusableElements(null), []);
  assert.deepEqual(getFocusableElements({}), []);
});

// Nr. 28 (Top-30): verschachtelte Dialoge sind gestapelt — nur der oberste
// besitzt Escape und die Tab-Falle. Sonst schließt ein Bestätigungs-Dialog
// über der Admin-Konsole (oder die Lightbox über dem Editor) mit demselben
// Tastendruck auch den Dialog darunter.
test('dialog stack: only the top-most dialog owns the keyboard', async () => {
  const { pushDialog, removeDialog, isTopDialog } = await import(moduleUrl);

  const editor = pushDialog();
  assert.ok(isTopDialog(editor), 'ein einzelner Dialog ist der oberste');

  const confirm = pushDialog();
  assert.ok(!isTopDialog(editor), 'der Dialog darunter muss still bleiben');
  assert.ok(isTopDialog(confirm), 'der zuletzt gemountete Dialog gewinnt');

  removeDialog(confirm);
  assert.ok(
    isTopDialog(editor),
    'nach dem Schließen des Overlays übernimmt der darunterliegende Dialog wieder'
  );

  removeDialog(editor);
  const fresh = pushDialog();
  assert.ok(isTopDialog(fresh), 'der Stack erholt sich, nachdem alle Dialoge zu waren');
  removeDialog(fresh);
});
