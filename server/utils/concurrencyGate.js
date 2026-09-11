/**
 * Tiny in-process concurrency gate.
 *
 * The Whisper container runs a single gunicorn worker (`--workers 1
 * --timeout 300`), so one long transcription blocks every other user for up to
 * five minutes. Piling requests up in front of it only produces timeouts, so the
 * server answers 429 + Retry-After once the gate is full instead of queueing
 * indefinitely.
 *
 * Pure module (no Express, no timers of its own) so `node --test` can drive it.
 */

const gates = new Map();

function gateFor(name, limit) {
  let gate = gates.get(name);
  if (!gate || gate.limit !== limit) {
    gate = { name, limit, active: 0 };
    gates.set(name, gate);
  }
  return gate;
}

/**
 * Try to enter a gated section.
 *
 * @param {string} name - Gate name (e.g. 'transcription')
 * @param {number} limit - Maximum concurrent holders
 * @returns {{acquired: boolean, active: number, limit: number, release: Function}}
 *   `release` is idempotent; call it exactly once when done.
 */
function acquire(name, limit = 1) {
  const gate = gateFor(name, limit);

  if (gate.active >= gate.limit) {
    return { acquired: false, active: gate.active, limit: gate.limit, release: () => {} };
  }

  gate.active += 1;
  let released = false;
  return {
    acquired: true,
    active: gate.active,
    limit: gate.limit,
    release: () => {
      if (released) return;
      released = true;
      gate.active = Math.max(0, gate.active - 1);
    }
  };
}

/**
 * Current occupancy, for logs and the health endpoint.
 * @param {string} name
 */
function inspect(name) {
  const gate = gates.get(name);
  return gate ? { name, active: gate.active, limit: gate.limit } : { name, active: 0, limit: 0 };
}

/** Test helper: forget all gates. */
function reset() {
  gates.clear();
}

module.exports = { acquire, inspect, reset };
