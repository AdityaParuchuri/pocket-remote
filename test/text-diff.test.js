import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffEdit } from '../public/js/text-diff.js';

test('appending characters only inserts', () => {
  assert.deepEqual(diffEdit('ab', 'abc'), { deleted: 0, inserted: 'c' });
});

test('deleting from the end only backspaces', () => {
  assert.deepEqual(diffEdit('abc', 'ab'), { deleted: 1, inserted: '' });
});

test('an unchanged value is a no-op', () => {
  assert.deepEqual(diffEdit('abc', 'abc'), { deleted: 0, inserted: '' });
});

test('autocorrect in the middle retypes everything after the first change', () => {
  // The Mac caret sits at the end, so "macbook " -> "MacBook " must delete all
  // 8 characters rather than just the changed span.
  assert.deepEqual(diffEdit('macbook ', 'MacBook '), { deleted: 8, inserted: 'MacBook ' });
  assert.deepEqual(diffEdit('ill', "I'll"), { deleted: 3, inserted: "I'll" });
});

test('replacing a whole word', () => {
  assert.deepEqual(diffEdit('hello teh', 'hello the'), { deleted: 2, inserted: 'he' });
});
