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
  // UI-Texte kommen aus den Katalogen (de + en), nicht aus dem JSX.
  assert.match(component, /t\('repairButton'\)/);
  assert.match(component, /t\('technicalHint'\)/);
  assert.doesNotMatch(component, /App sicher aktualisieren/);
  assert.doesNotMatch(component, /Technischer Hinweis:/);
  assert.match(component, /diagnostic\.code/);
  assert.doesNotMatch(component, /Browser-Cache leeren/);
  assert.match(styles, /\.error-boundary-button:focus-visible/);
});
