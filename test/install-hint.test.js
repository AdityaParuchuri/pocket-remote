import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldShowInstallHint } from '../public/js/install-hint.js';

test('shows once for iOS browsers that have not installed the app', () => {
  assert.equal(shouldShowInstallHint({ isIos: true, isStandalone: false, alreadyShown: false }), true);
});

test('stays quiet after it has been shown, when installed, or off iOS', () => {
  assert.equal(shouldShowInstallHint({ isIos: true, isStandalone: false, alreadyShown: true }), false);
  assert.equal(shouldShowInstallHint({ isIos: true, isStandalone: true, alreadyShown: false }), false);
  assert.equal(shouldShowInstallHint({ isIos: false, isStandalone: false, alreadyShown: false }), false);
});
