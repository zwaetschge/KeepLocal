const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const component = fs.readFileSync(
  path.join(__dirname, '../src/components/ErrorBoundary.jsx'),
  'utf8'
);
const styles = fs.readFileSync(
  path.join(__dirname, '../src/components/ErrorBoundary.css'),
  'utf8'
);

test('error boundary offers safe cache recovery and a non-sensitive diagnostic', () => {
  assert.match(component, /repairAppState/);
  assert.match(component, /App sicher aktualisieren/);
  assert.match(component, /diagnostic\.code/);
  assert.match(component, /Technischer Hinweis/);
  assert.doesNotMatch(component, /Browser-Cache leeren/);
  assert.match(styles, /\.error-boundary-button:focus-visible/);
});
