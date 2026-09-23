import { initWindowSwitcher } from './window-switcher.js';
import { initHud } from './hud.js';
import { initInstallHint } from './install-hint.js';
import { initKeyboard } from './keyboard.js';
import { initScrollPill } from './scroll-pill.js';
import { initSession } from './session.js';
import { initTrackpad } from './trackpad.js';
import { initTransport } from './transport.js';

// iOS Safari only applies :active styles when some listener on the page
// handles touch events; this no-op enables press feedback on plain buttons.
document.body.addEventListener('touchstart', () => {}, { passive: true });

initSession();
initTransport();
initHud();
initTrackpad();
initScrollPill();
initWindowSwitcher();
initKeyboard();
initInstallHint();
