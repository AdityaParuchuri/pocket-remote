import { flash } from './status.js';
import { getStored, setStored } from './util.js';

const HINT_KEY = 'installHintShown';
const HINT_MS = 7000;

/** Suggest adding to the Home Screen once, on iOS Safari (where it can't be done automatically). */
export function shouldShowInstallHint({ isIos, isStandalone, alreadyShown }) {
  return isIos && !isStandalone && !alreadyShown;
}

export function initInstallHint() {
  const shouldShow = shouldShowInstallHint({
    isIos: /iPhone|iPad|iPod/.test(navigator.userAgent),
    isStandalone: navigator.standalone === true,
    alreadyShown: getStored(HINT_KEY) === '1',
  });
  if (!shouldShow) return;
  setStored(HINT_KEY, '1');
  flash('Tip: tap Share, then Add to Home Screen', HINT_MS, false);
}
