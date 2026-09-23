import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VOLUME_LEVELS, steppedVolume } from '../src/mac/volume.js';

test('steps one of the 16 macOS levels at a time', () => {
  assert.equal(VOLUME_LEVELS, 16);
  assert.equal(steppedVolume(0, 1), 7);
  assert.equal(steppedVolume(7, 1), 13);
  assert.equal(steppedVolume(100, -1), 93);
});

test('never goes below 0 or above 100', () => {
  assert.equal(steppedVolume(0, -1), 0);
  assert.equal(steppedVolume(100, 1), 100);
});

test('snaps an off-grid volume to the nearest level before stepping', () => {
  assert.equal(steppedVolume(50, 1), 60);
});
