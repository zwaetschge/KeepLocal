const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateFeatures } = require('../utils/noteFeatures');
test('the shared representation accepts explicit nullable image references and UTF-16 spans', () => {
  assert.doesNotThrow(() =>
    validateFeatures(
      {
        format: 'rich',
        marks: [{ type: 'bold', start: 3, end: 7 }],
        list: { checkedToBottom: true },
        drawing: { width: 800, height: 600, imageFilename: null, strokes: [] },
      },
      7,
    ),
  );
});
test('malformed shapes cannot produce notes which a typed native client cannot read', () => {
  for (const input of [
    { list: 123 },
    { list: [] },
    { drawing: { width: 1.5, height: 600, strokes: [] } },
    {
      drawing: {
        width: 800,
        height: 600,
        strokes: [{ color: '#202124', width: 3, points: [[801, 3]] }],
      },
    },
  ])
    assert.throws(() => validateFeatures(input), { statusCode: 400 });
});
