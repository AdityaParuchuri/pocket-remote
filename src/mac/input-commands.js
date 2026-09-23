import { LIMITS } from '../config.js';
import { clamp } from '../util.js';

// Line protocol understood by input-daemon.jxa.
export const commands = {
  move: (dx, dy) => `move ${dx} ${dy}`,
  click: () => 'click',
  scroll: (dy, dx) => `scroll ${dy} ${dx}`,
  endDrag: () => 'end',
  type: (text) => {
    const clean = String(text).slice(0, LIMITS.typeChars).replace(/[\r\n]/g, ' ');
    return `type ${JSON.stringify(clean)}`;
  },
  backspace: (count) => `backspace ${clamp(Math.floor(count) || 1, 1, LIMITS.backspaces)}`,
  enter: () => 'return',
};
