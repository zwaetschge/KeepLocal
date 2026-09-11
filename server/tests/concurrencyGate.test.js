const test = require('node:test');
const assert = require('node:assert/strict');

// Improvement #7: the Whisper container runs one gunicorn worker, so the server
// gates concurrent transcriptions instead of queueing requests into timeouts.
const gate = require('../utils/concurrencyGate');

test('a gate admits requests up to its limit and refuses the rest', () => {
  gate.reset();

  const first = gate.acquire('transcription', 2);
  const second = gate.acquire('transcription', 2);
  const third = gate.acquire('transcription', 2);

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, true);
  assert.equal(third.acquired, false);
  assert.deepEqual(gate.inspect('transcription'), { name: 'transcription', active: 2, limit: 2 });

  second.release();
  assert.equal(gate.inspect('transcription').active, 1);

  const fourth = gate.acquire('transcription', 2);
  assert.equal(fourth.acquired, true);
});

test('release is idempotent and never drops below zero', () => {
  gate.reset();

  const slot = gate.acquire('x', 1);
  slot.release();
  slot.release();
  slot.release();

  assert.equal(gate.inspect('x').active, 0);
  assert.equal(gate.acquire('x', 1).acquired, true);
});

test('a refused acquire returns a harmless release and the current occupancy', () => {
  gate.reset();

  const held = gate.acquire('y', 1);
  const refused = gate.acquire('y', 1);

  assert.equal(refused.acquired, false);
  assert.equal(refused.active, 1);
  assert.equal(refused.limit, 1);
  refused.release();
  assert.equal(gate.inspect('y').active, 1, 'refusing must not free the holder');

  held.release();
  assert.equal(gate.inspect('y').active, 0);
});

test('gates are independent and unknown gates report zero', () => {
  gate.reset();

  gate.acquire('a', 1);
  assert.equal(gate.acquire('b', 1).acquired, true);
  assert.deepEqual(gate.inspect('never-used'), { name: 'never-used', active: 0, limit: 0 });
});
