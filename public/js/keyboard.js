import { send } from './session.js';
import { diffEdit } from './text-diff.js';

// Invisible character that keeps the proxy non-empty: an empty textarea fires
// no `input` event for Backspace, so the first delete would otherwise be lost.
const SENTINEL = '​';
const NO_TEXT_MS = 1500;

/**
 * The overlay holds a proxy textarea that only exists so iOS shows its native
 * keyboard (autocorrect, swipe-typing, ...). Its content is treated as the
 * source of truth: every edit is diffed against the last synced value and
 * replayed on the Mac. Edits are queued so a slow request can't overtake a
 * later one.
 */
export function initKeyboard() {
  const overlay = document.getElementById('keyboardOverlay');
  const proxy = document.getElementById('kbProxy');
  const hint = document.getElementById('kbHint');
  const syncButton = document.getElementById('keyboardPull');
  const defaultHint = hint.textContent;

  let synced = SENTINEL;
  let queue = Promise.resolve();
  let syncing = false;

  function reset() {
    proxy.value = SENTINEL;
    proxy.setSelectionRange(SENTINEL.length, SENTINEL.length);
    synced = SENTINEL;
    queue = Promise.resolve();
  }

  proxy.addEventListener('input', () => {
    const { deleted, inserted } = diffEdit(synced, proxy.value);
    synced = proxy.value;
    queue = queue.then(async () => {
      if (deleted > 0) await send('keyboard/backspace', { count: deleted });
      if (inserted === '\n') await send('keyboard/return');
      else if (inserted) await send('keyboard/type', { text: inserted });
    });
  });

  // iOS shrinks the visual viewport, not the layout viewport, when its
  // keyboard opens, so pad the bottom-docked overlay by the covered height.
  function syncKeyboardInset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const covered = window.innerHeight - vv.height - vv.offsetTop;
    overlay.style.paddingBottom = `${Math.max(0, covered)}px`;
  }
  window.visualViewport?.addEventListener('resize', syncKeyboardInset);
  window.visualViewport?.addEventListener('scroll', syncKeyboardInset);

  function showNoText() {
    hint.textContent = 'No text found';
    hint.classList.add('error');
    syncButton.hidden = true;
    setTimeout(() => {
      hint.textContent = defaultHint;
      hint.classList.remove('error');
      syncButton.hidden = false;
    }, NO_TEXT_MS);
  }

  // Pulls the focused Mac text field into the proxy. `synced` is updated too,
  // so the pulled text isn't diffed and typed back onto the Mac.
  async function pullFromMac() {
    if (syncing) return;
    syncing = true;
    syncButton.classList.add('busy');
    await queue; // let in-flight typing land before Cmd+A / Cmd+C
    const data = await send('keyboard/pull');
    syncButton.classList.remove('busy');
    syncing = false;
    if (!data) return;
    if (!data.text) {
      showNoText();
      return;
    }
    const value = SENTINEL + data.text;
    proxy.value = value;
    synced = value;
    proxy.setSelectionRange(value.length, value.length);
    proxy.focus({ preventScroll: true });
  }

  // preventDefault on mousedown keeps the proxy focused so the iOS keyboard
  // stays up; doing it on touchstart would cancel the click on iOS.
  syncButton.addEventListener('mousedown', (e) => e.preventDefault());
  syncButton.onclick = pullFromMac;

  document.getElementById('keyboardIcon').onclick = () => {
    overlay.classList.add('visible');
    reset();
    proxy.focus({ preventScroll: true });
    syncKeyboardInset();
  };
  document.getElementById('keyboardClose').onclick = () => {
    overlay.classList.remove('visible');
    overlay.style.paddingBottom = '';
    proxy.blur();
  };
}
