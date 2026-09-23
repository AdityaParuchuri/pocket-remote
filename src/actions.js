import { LIMITS } from './config.js';
import { HttpError, clampDelta } from './util.js';

function delta(body, limit) {
  const clamped = clampDelta(body.dx, body.dy, limit);
  if (!clamped) throw new HttpError(400, 'invalid dx/dy');
  return clamped;
}

const KEY_ACTIONS = [
  'playpause', 'rewind', 'forward',
  'space/prev', 'space/next', 'mission-control', 'app-expose',
  'brightness/up', 'brightness/down',
];

/**
 * Maps `POST /api/<name>` to a handler. Handlers receive the parsed JSON body
 * and may return extra fields to merge into the `{ ok: true }` response.
 */
export function createActions(mac) {
  const actions = {
    'mouse/move': async (body) => {
      const [dx, dy] = delta(body, LIMITS.mouseMove);
      await mac.input.move(dx, dy);
    },
    'mouse/click': () => mac.input.click(),
    'mouse/scroll': async (body) => {
      const [dx, dy] = delta(body, LIMITS.scroll);
      await mac.input.scroll(dy, dx);
    },
    'mouse/end': () => mac.input.endDrag(),

    'volume/up': async () => ({ volume: await mac.changeVolume(1) }),
    'volume/down': async () => ({ volume: await mac.changeVolume(-1) }),
    mute: async () => {
      const muted = await mac.toggleMute();
      return { muted, volume: await mac.getVolume() };
    },

    'keyboard/type': async ({ text }) => {
      if (typeof text !== 'string' || !text) throw new HttpError(400, 'missing text');
      await mac.input.type(text);
    },
    'keyboard/backspace': ({ count }) => mac.input.backspace(Number(count) || 1),
    'keyboard/return': () => mac.input.enter(),
    'keyboard/pull': async () => ({ text: await mac.pullText() }),
  };

  for (const name of KEY_ACTIONS) actions[name] = () => mac.pressKey(name);
  return actions;
}
