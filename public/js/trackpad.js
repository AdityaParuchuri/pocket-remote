import { centroid, threeFingerAction } from './gestures.js';
import { click, endDrag, moveCursor, scroll, SCROLL_SENSITIVITY } from './pointer.js';
import { send } from './session.js';
import { vibrate } from './util.js';

const SENSITIVITY = 1.6;
const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 8;

/**
 * Emulates a MacBook trackpad: one finger moves the cursor and taps to click,
 * two fingers scroll (content follows the finger), and three fingers swipe to
 * switch Spaces or open Mission Control / App Exposé. The mode is set by the
 * highest finger count seen and never downgrades mid-gesture.
 */
export function initTrackpad() {
  const trackpad = document.getElementById('trackpad');
  let state = null;

  const modeFor = (fingers) => (fingers === 1 ? 'pointer' : fingers === 2 ? 'scroll' : 'gesture');

  function finish() {
    trackpad.classList.remove('active');
    if (state?.mode === 'pointer') endDrag();
  }

  trackpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    trackpad.classList.add('active');
    const fingers = e.touches.length;
    const { x, y } = centroid(e.touches);

    if (!state) {
      state = {
        mode: modeFor(fingers),
        startX: x, startY: y, lastX: x, lastY: y,
        startTime: Date.now(), moved: false, maxFingers: fingers,
      };
      return;
    }
    state.maxFingers = Math.max(state.maxFingers, fingers);
    if (state.mode === 'pointer' && fingers >= 2) endDrag();
    if (fingers >= 3) state.mode = 'gesture';
    else if (fingers === 2 && state.mode !== 'gesture') state.mode = 'scroll';
    state.lastX = x;
    state.lastY = y;
  }, { passive: false });

  trackpad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!state) return;
    const fingers = e.touches.length;
    state.maxFingers = Math.max(state.maxFingers, fingers);
    const { x, y } = centroid(e.touches);
    const dx = x - state.lastX;
    const dy = y - state.lastY;

    if (state.mode === 'pointer' && fingers === 1) {
      moveCursor(dx * SENSITIVITY, dy * SENSITIVITY);
    } else if (state.mode === 'scroll' && fingers === 2) {
      scroll(-dy * SCROLL_SENSITIVITY, -dx * SCROLL_SENSITIVITY);
    }
    // Three-finger gestures are decided once, at touchend.

    state.lastX = x;
    state.lastY = y;
    if (Math.abs(x - state.startX) > TAP_MAX_MOVE || Math.abs(y - state.startY) > TAP_MAX_MOVE) {
      state.moved = true;
    }
  }, { passive: false });

  trackpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!state) return;
    if (e.touches.length > 0) {
      // Resync so the centroid doesn't jump when computed over fewer fingers.
      const { x, y } = centroid(e.touches);
      state.lastX = x;
      state.lastY = y;
      return;
    }

    const { mode, maxFingers, moved, startTime } = state;
    const totalDx = state.lastX - state.startX;
    const totalDy = state.lastY - state.startY;
    finish();

    if (mode === 'gesture' && maxFingers >= 3) {
      const action = threeFingerAction(totalDx, totalDy);
      if (action) send(action);
    } else if (mode === 'pointer' && maxFingers === 1 && !moved && Date.now() - startTime < TAP_MAX_MS) {
      if (click()) vibrate();
    }
    state = null;
  }, { passive: false });

  trackpad.addEventListener('touchcancel', () => {
    finish();
    state = null;
  }, { passive: false });
}
