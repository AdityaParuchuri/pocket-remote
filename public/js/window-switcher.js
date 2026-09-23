import { barAction } from './gestures.js';
import { send } from './session.js';

/** Tap either half or swipe sideways on the bar to switch Spaces. */
export function initWindowSwitcher() {
  const bar = document.getElementById('windowSwitcher');
  let start = null;

  bar.addEventListener('touchstart', (e) => {
    e.preventDefault();
    bar.classList.add('active');
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
  }, { passive: false });

  bar.addEventListener('touchend', (e) => {
    e.preventDefault();
    bar.classList.remove('active');
    if (!start) return;
    const touch = e.changedTouches[0];
    const { left, width } = bar.getBoundingClientRect();
    const action = barAction({
      dx: touch.clientX - start.x,
      dy: touch.clientY - start.y,
      elapsedMs: Date.now() - start.time,
      startX: start.x,
      left,
      width,
    });
    if (action) send(action);
    start = null;
  }, { passive: false });

  bar.addEventListener('touchcancel', () => {
    bar.classList.remove('active');
    start = null;
  }, { passive: false });
}
