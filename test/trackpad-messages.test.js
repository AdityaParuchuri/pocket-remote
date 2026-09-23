import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleTrackpadMessage } from '../src/trackpad-messages.js';

function fakeInput() {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve();
  };
  return {
    calls,
    move: record('move'),
    scroll: record('scroll'),
    click: record('click'),
    endDrag: record('endDrag'),
  };
}

test('routes move, scroll, click and end', () => {
  const input = fakeInput();
  handleTrackpadMessage('move 3 -4', input);
  handleTrackpadMessage('scroll 10 2', input);
  handleTrackpadMessage('click', input);
  handleTrackpadMessage('end', input);
  assert.deepEqual(input.calls, [
    ['move', 3, -4],
    ['scroll', 10, 2],
    ['click'],
    ['endDrag'],
  ]);
});

test('clamps oversized deltas', () => {
  const input = fakeInput();
  handleTrackpadMessage('move 99999 -99999', input);
  handleTrackpadMessage('scroll 99999 -99999', input);
  assert.deepEqual(input.calls, [['move', 800, -800], ['scroll', 2000, -2000]]);
});

test('ignores malformed and unknown messages', () => {
  const input = fakeInput();
  handleTrackpadMessage('move abc 1', input);
  handleTrackpadMessage('move', input);
  handleTrackpadMessage('explode 1 2', input);
  handleTrackpadMessage('', input);
  assert.deepEqual(input.calls, []);
});

test('does not throw when the input daemon is unavailable', async () => {
  const failing = () => Promise.reject(new Error('input control unavailable'));
  const input = { move: failing, scroll: failing, click: failing, endDrag: () => {} };
  handleTrackpadMessage('move 1 1', input);
  handleTrackpadMessage('click', input);
  await new Promise((resolve) => setImmediate(resolve));
});
