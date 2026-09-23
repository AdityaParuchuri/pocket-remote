import { send, sendSocket } from './session.js';

export const SCROLL_SENSITIVITY = 1.2;

// Pointer commands prefer the WebSocket and fall back to HTTP until it opens.

export function moveCursor(dx, dy) {
  if (dx === 0 && dy === 0) return;
  if (!sendSocket(`move ${dx} ${dy}`)) send('mouse/move', { dx, dy });
}

export function scroll(dy, dx) {
  if (dy === 0 && dx === 0) return;
  if (!sendSocket(`scroll ${dy} ${dx}`)) send('mouse/scroll', { dx, dy });
}

/** Returns whether the click went over the WebSocket. */
export function click() {
  if (sendSocket('click')) return true;
  send('mouse/click');
  return false;
}

export function endDrag() {
  if (!sendSocket('end')) send('mouse/end');
}
