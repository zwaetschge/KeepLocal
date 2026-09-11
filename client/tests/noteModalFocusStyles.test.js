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

// Focus must stay visible in the note editor (WCAG 2.4.7). The global input
// focus frame is suppressed, but every field replaces it with its own visible
// indicator — an accent outline, or the accent underline for the title.
test('note modal title focus-visible shows the accent underline instead of the global input focus frame', () => {
  const declarations = declarationsFor('.note-modal-title:focus-visible');

  assert.match(declarations, /outline:\s*none/);
  assert.match(declarations, /box-shadow:\s*none/);
  assert.match(declarations, /border-bottom-color:\s*var\(--accent-color/);
});

test('e-ink mode does not force a visible note modal title underline', () => {
  const declarations = declarationsFor('.eink-mode .note-modal-title');

  assert.match(declarations, /border-bottom-color:\s*transparent/);
});

test('all note modal text entry fields keep a visible focus indicator', () => {
  // The title uses the accent underline instead (covered by the test above).
  for (const selector of [
    '.note-modal-content:focus-visible',
    '.note-modal-tags-input:focus-visible',
    '.note-modal-tags:focus-visible',
    '.todo-item-input:focus-visible',
  ]) {
    const declarations = declarationsFor(selector);

    // The global focus frame is replaced, not removed...
    assert.match(declarations, /outline:\s*none/, selector);
    assert.match(declarations, /box-shadow:\s*none/, selector);
    // ...by a visible accent outline (the last outline declaration wins).
    const outlines = declarations.match(/outline:\s*[^;]+;/g) || [];
    assert.match(
      outlines[outlines.length - 1],
      /outline:\s*2px solid var\(--accent-color/,
      selector
    );
  }
});
