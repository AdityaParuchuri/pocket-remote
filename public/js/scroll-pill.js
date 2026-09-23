import { SCROLL_SENSITIVITY, scroll } from './pointer.js';
import { vibrate } from './util.js';

const NUDGE = 80;
const TAP_MAX_MS = 300;
const TAP_MAX_MOVE = 6;

/** Tap the top or bottom half to nudge, or drag anywhere to scroll continuously. */
export function initScrollPill() {
  const pill = document.getElementById('scrollPill');
  let drag = null;

  pill.addEventListener('touchstart', (e) => {
    e.preventDefault();
    pill.classList.add('active');
    const { clientY } = e.touches[0];
    drag = { startY: clientY, lastY: clientY, startTime: Date.now(), moved: false };
  }, { passive: false });

  pill.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!drag) return;
    const { clientY } = e.touches[0];
    if (Math.abs(clientY - drag.startY) > TAP_MAX_MOVE) drag.moved = true;
    if (drag.moved) scroll(-(clientY - drag.lastY) * SCROLL_SENSITIVITY, 0);
    drag.lastY = clientY;
  }, { passive: false });

  pill.addEventListener('touchend', (e) => {
    e.preventDefault();
    pill.classList.remove('active');
    if (!drag) return;
    if (!drag.moved && Date.now() - drag.startTime < TAP_MAX_MS) {
      const rect = pill.getBoundingClientRect();
      const inTopHalf = drag.startY < rect.top + rect.height / 2;
      scroll(inTopHalf ? -NUDGE : NUDGE, 0);
      vibrate();
    }
    drag = null;
  }, { passive: false });

  pill.addEventListener('touchcancel', () => {
    pill.classList.remove('active');
    drag = null;
  }, { passive: false });
}
