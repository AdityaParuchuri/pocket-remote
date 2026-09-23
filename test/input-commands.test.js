import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS } from '../src/config.js';
import { commands } from '../src/mac/input-commands.js';

test('formats pointer commands', () => {
  assert.equal(commands.move(1.5, -2), 'move 1.5 -2');
  assert.equal(commands.scroll(10, 0), 'scroll 10 0');
  assert.equal(commands.click(), 'click');
  assert.equal(commands.endDrag(), 'end');
  assert.equal(commands.enter(), 'return');
});

test('type encodes text as JSON so spaces and quotes survive the line protocol', () => {
  assert.equal(commands.type('say "hi" now'), 'type "say \\"hi\\" now"');
});

test('type flattens newlines and truncates long text', () => {
  assert.equal(commands.type('a\nb\r\nc'), 'type "a b  c"');
  const line = commands.type('x'.repeat(LIMITS.typeChars + 100));
  assert.equal(JSON.parse(line.slice(5)).length, LIMITS.typeChars);
});

test('backspace count is at least 1 and at most the limit', () => {
  assert.equal(commands.backspace(3), 'backspace 3');
  assert.equal(commands.backspace(0), 'backspace 1');
  assert.equal(commands.backspace(NaN), 'backspace 1');
  assert.equal(commands.backspace(9999), `backspace ${LIMITS.backspaces}`);
});
