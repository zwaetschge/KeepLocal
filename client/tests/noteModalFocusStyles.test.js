const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(
  path.join(__dirname, '../src/components/NoteModal.css'),
  'utf8'
);

function declarationsFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm'));

  assert.ok(match, `${selector} rule is missing`);
  return match[1].replace(/\s+/g, ' ');
}

test('note modal title focus-visible does not render the global input focus frame', () => {
  const declarations = declarationsFor('.note-modal-title:focus-visible');

  assert.match(declarations, /outline:\s*none/);
  assert.match(declarations, /box-shadow:\s*none/);
});

test('note modal title focus does not draw a visible underline', () => {
  const declarations = declarationsFor('.note-modal-title:focus');

  assert.match(declarations, /border-bottom-color:\s*transparent/);
});

test('e-ink mode does not force a visible note modal title underline', () => {
  const declarations = declarationsFor('.eink-mode .note-modal-title');

  assert.match(declarations, /border-bottom-color:\s*transparent/);
});

test('note modal content focus-visible does not render the global textarea focus frame', () => {
  const declarations = declarationsFor('.note-modal-content:focus-visible');

  assert.match(declarations, /outline:\s*none/);
  assert.match(declarations, /box-shadow:\s*none/);
});
