import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActions } from '../src/actions.js';
import { HttpError } from '../src/util.js';

function fakeMac() {
  const calls = [];
  const record = (name, result) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(result);
  };
  return {
    calls,
    pressKey: record('pressKey'),
    changeVolume: record('changeVolume', 40),
    toggleMute: record('toggleMute', true),
    getVolume: record('getVolume', 40),
    pullText: record('pullText', 'hello'),
    input: {
      move: record('move'),
      scroll: record('scroll'),
      click: record('click'),
      endDrag: record('endDrag'),
      type: record('type'),
      backspace: record('backspace'),
      enter: record('enter'),
    },
  };
}

test('media and window actions press their key', async () => {
  const mac = fakeMac();
  const actions = createActions(mac);
  for (const name of ['playpause', 'rewind', 'space/next', 'mission-control', 'brightness/up']) {
    await actions[name]({});
  }
  assert.deepEqual(mac.calls.map(([, name]) => name), [
    'playpause', 'rewind', 'space/next', 'mission-control', 'brightness/up',
  ]);
});

test('volume actions report the new volume', async () => {
  const mac = fakeMac();
  const actions = createActions(mac);
  assert.deepEqual(await actions['volume/up']({}), { volume: 40 });
  await actions['volume/down']({});
  assert.deepEqual(mac.calls, [['changeVolume', 1], ['changeVolume', -1]]);
});

test('mute reports the mute state and current volume', async () => {
  const actions = createActions(fakeMac());
  assert.deepEqual(await actions.mute({}), { muted: true, volume: 40 });
});

test('mouse/move clamps deltas', async () => {
  const mac = fakeMac();
  await createActions(mac)['mouse/move']({ dx: 5000, dy: -3 });
  assert.deepEqual(mac.calls, [['move', 800, -3]]);
});

test('mouse/scroll passes vertical delta first', async () => {
  const mac = fakeMac();
  await createActions(mac)['mouse/scroll']({ dx: 1, dy: 2 });
  assert.deepEqual(mac.calls, [['scroll', 2, 1]]);
});

test('mouse actions reject invalid deltas with a 400', async () => {
  const actions = createActions(fakeMac());
  for (const name of ['mouse/move', 'mouse/scroll']) {
    await assert.rejects(actions[name]({ dx: 'x', dy: 1 }), (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 400);
      return true;
    });
  }
});

test('keyboard/type requires non-empty text', async () => {
  const mac = fakeMac();
  const actions = createActions(mac);
  await assert.rejects(actions['keyboard/type']({}), HttpError);
  await assert.rejects(actions['keyboard/type']({ text: '' }), HttpError);
  await assert.rejects(actions['keyboard/type']({ text: 5 }), HttpError);
  await actions['keyboard/type']({ text: 'hi' });
  assert.deepEqual(mac.calls, [['type', 'hi']]);
});

test('keyboard/backspace defaults to a single backspace', async () => {
  const mac = fakeMac();
  const actions = createActions(mac);
  await actions['keyboard/backspace']({});
  await actions['keyboard/backspace']({ count: 4 });
  assert.deepEqual(mac.calls, [['backspace', 1], ['backspace', 4]]);
});

test('keyboard/pull returns the text from the Mac', async () => {
  const actions = createActions(fakeMac());
  assert.deepEqual(await actions['keyboard/pull']({}), { text: 'hello' });
});
