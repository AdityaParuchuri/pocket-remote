import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEYS, keyScript } from '../src/mac/keys.js';

test('builds a plain key press script', () => {
  assert.equal(
    keyScript({ code: 49 }),
    'tell application "System Events" to key code 49',
  );
});

test('builds a script with a modifier', () => {
  assert.equal(
    keyScript(KEYS['space/next']),
    'tell application "System Events" to key code 124 using {control down}',
  );
});

test('every key has a numeric code', () => {
  for (const [name, key] of Object.entries(KEYS)) {
    assert.equal(typeof key.code, 'number', name);
  }
});
