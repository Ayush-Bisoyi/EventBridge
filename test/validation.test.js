import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePayload } from '../src/validation.js';

test('accepts a non-empty JSON object', () => {
  assert.deepEqual(validatePayload({ type: 'push' }), { ok: true });
});

test('rejects null, arrays, and empty objects', () => {
  assert.equal(validatePayload(null).ok, false);
  assert.equal(validatePayload([]).ok, false);
  assert.equal(validatePayload({}).ok, false);
});

