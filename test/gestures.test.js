import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barAction, centroid, threeFingerAction } from '../public/js/gestures.js';

test('centroid averages touch positions', () => {
  const touches = [{ clientX: 0, clientY: 0 }, { clientX: 10, clientY: 20 }];
  assert.deepEqual(centroid(touches), { x: 5, y: 10 });
});

test('three-finger horizontal swipes switch spaces', () => {
  assert.equal(threeFingerAction(-60, 5), 'space/next');
  assert.equal(threeFingerAction(60, -5), 'space/prev');
});

test('three-finger vertical swipes open Mission Control / App Exposé', () => {
  assert.equal(threeFingerAction(3, -60), 'mission-control');
  assert.equal(threeFingerAction(3, 60), 'app-expose');
});

test('three-finger movement below the threshold does nothing', () => {
  assert.equal(threeFingerAction(30, 30), null);
  assert.equal(threeFingerAction(0, 0), null);
});

const BAR = { left: 20, width: 200 };
const touch = (overrides) => barAction({ dx: 0, dy: 0, elapsedMs: 100, startX: 50, ...BAR, ...overrides });

test('the window switcher bar follows a horizontal swipe', () => {
  assert.equal(touch({ dx: -30, dy: 2 }), 'space/next');
  assert.equal(touch({ dx: 30, dy: 2 }), 'space/prev');
});

test('the window switcher bar ignores slow or mostly-vertical drags', () => {
  assert.equal(touch({ dx: 15, elapsedMs: 100 }), null);
  assert.equal(touch({ dx: 30, dy: 40 }), null);
  assert.equal(touch({ elapsedMs: 600 }), null);
});

test('tapping the left or right half switches to the previous or next Space', () => {
  assert.equal(touch({ startX: 50 }), 'space/prev');
  assert.equal(touch({ startX: 200 }), 'space/next');
  assert.equal(touch({ startX: 120 }), 'space/next'); // exact midpoint counts as right
});
