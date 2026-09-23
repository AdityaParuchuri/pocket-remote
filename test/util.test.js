import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError, clamp, clampDelta } from '../src/util.js';

test('clamp limits a value to the range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});

test('clampDelta clamps both values symmetrically', () => {
  assert.deepEqual(clampDelta(5000, -5000, 800), [800, -800]);
  assert.deepEqual(clampDelta('3', '-4', 800), [3, -4]);
});

test('clampDelta rejects non-numeric input', () => {
  assert.equal(clampDelta('abc', 1, 800), null);
  assert.equal(clampDelta(undefined, 1, 800), null);
  assert.equal(clampDelta(NaN, 1, 800), null);
});

test('HttpError carries a status code', () => {
  const err = new HttpError(400, 'bad');
  assert.equal(err.status, 400);
  assert.equal(err.message, 'bad');
  assert.ok(err instanceof Error);
});
