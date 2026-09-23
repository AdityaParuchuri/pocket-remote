export const SWIPE_THRESHOLD = 40;
export const BAR_SWIPE_THRESHOLD = 24;
export const BAR_TAP_MAX_MS = 300;
export const BAR_TAP_MAX_MOVE = 6;

export function centroid(touches) {
  let x = 0;
  let y = 0;
  for (const touch of touches) {
    x += touch.clientX;
    y += touch.clientY;
  }
  return { x: x / touches.length, y: y / touches.length };
}

/** Maps a three-finger swipe to a Mac action: sideways switches Spaces, vertical opens Mission Control / App Exposé. */
export function threeFingerAction(dx, dy) {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX > SWIPE_THRESHOLD && absX > absY) return dx < 0 ? 'space/next' : 'space/prev';
  if (absY > SWIPE_THRESHOLD && absY > absX) return dy < 0 ? 'mission-control' : 'app-expose';
  return null;
}

/**
 * Maps a touch on the window switcher bar to a Space switch: a horizontal
 * swipe follows the finger, and a short tap on the left or right half goes
 * to the previous or next Space.
 */
export function barAction({ dx, dy, elapsedMs, startX, left, width }) {
  if (Math.abs(dx) > BAR_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? 'space/next' : 'space/prev';
  }
  const moved = Math.max(Math.abs(dx), Math.abs(dy));
  if (moved <= BAR_TAP_MAX_MOVE && elapsedMs < BAR_TAP_MAX_MS) {
    return startX < left + width / 2 ? 'space/prev' : 'space/next';
  }
  return null;
}
