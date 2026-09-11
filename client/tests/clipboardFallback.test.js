const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/clipboard.mjs')
).href;

/** Minimal fake DOM document for the legacy copy path. */
function createFakeDocument({ execCommandResult = true } = {}) {
  const created = [];
  const body = {
    children: [],
    appendChild(node) { this.children.push(node); },
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
    },
  };
  return {
    body,
    created,
    createElement(tag) {
      const element = {
        tagName: tag.toUpperCase(),
        value: '',
        attributes: {},
        style: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        select() { this.selected = true; },
        setSelectionRange(start, end) { this.range = [start, end]; },
      };
      created.push(element);
      return element;
    },
    execCommand(command) {
      this.lastCommand = command;
      return execCommandResult;
    },
  };
}

test('copyToClipboard uses the async clipboard API when available', async () => {
  const { copyToClipboard } = await import(moduleUrl);

  const written = [];
  const doc = createFakeDocument();
  const navigator = {
    clipboard: {
      writeText: async (text) => { written.push(text); },
    },
  };

  const result = await copyToClipboard('sk-live-123', { document: doc, navigator });

  assert.equal(result, true);
  assert.deepEqual(written, ['sk-live-123']);
  assert.equal(doc.created.length, 0, 'must not create a fallback textarea');
});

test('copyToClipboard falls back to a hidden textarea when the API rejects', async () => {
  const { copyToClipboard } = await import(moduleUrl);

  const doc = createFakeDocument();
  const navigator = {
    clipboard: {
      writeText: async () => { throw new Error('not allowed'); },
    },
  };

  const result = await copyToClipboard('sk-live-123', { document: doc, navigator });

  assert.equal(result, true);
  assert.equal(doc.lastCommand, 'copy');
  assert.equal(doc.created.length, 1);
  const textarea = doc.created[0];
  assert.equal(textarea.tagName, 'TEXTAREA');
  assert.equal(textarea.value, 'sk-live-123');
  assert.equal(textarea.attributes.readonly, '');
  assert.equal(textarea.style.position, 'fixed');
  assert.equal(doc.body.children.length, 0, 'textarea must be removed after copying');
});

test('copyToClipboard falls back when navigator.clipboard is missing (plain HTTP)', async () => {
  const { copyToClipboard } = await import(moduleUrl);

  const doc = createFakeDocument();
  const result = await copyToClipboard('hello', { document: doc, navigator: {} });

  assert.equal(result, true);
  assert.equal(doc.lastCommand, 'copy');
});

test('copyToClipboard reports failure when execCommand returns false', async () => {
  const { copyToClipboard } = await import(moduleUrl);

  const doc = createFakeDocument({ execCommandResult: false });
  const result = await copyToClipboard('hello', { document: doc, navigator: {} });

  assert.equal(result, false);
  assert.equal(doc.body.children.length, 0, 'textarea must still be cleaned up');
});

test('copyToClipboard survives a throwing execCommand', async () => {
  const { copyToClipboard } = await import(moduleUrl);

  const doc = createFakeDocument();
  doc.execCommand = () => { throw new Error('unsupported'); };

  const result = await copyToClipboard('hello', { document: doc, navigator: {} });

  assert.equal(result, false);
  assert.equal(doc.body.children.length, 0);
});
