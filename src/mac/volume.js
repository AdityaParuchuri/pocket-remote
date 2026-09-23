import { clamp } from '../util.js';
import { runOsascript } from './osascript.js';

// macOS steps its volume through 16 discrete levels, so step by level rather
// than a fixed percentage to stay in sync with the physical keys.
export const VOLUME_LEVELS = 16;

export function steppedVolume(current, direction) {
  const level = Math.round((current / 100) * (VOLUME_LEVELS - 1));
  const next = clamp(level + direction, 0, VOLUME_LEVELS - 1);
  return Math.round((next / (VOLUME_LEVELS - 1)) * 100);
}

export async function getVolume() {
  const volume = parseInt(await runOsascript('output volume of (get volume settings)'), 10);
  if (!Number.isFinite(volume)) throw new Error('could not read volume');
  return volume;
}

async function setVolume(volume) {
  const clamped = clamp(Math.round(volume), 0, 100);
  await runOsascript(`set volume output volume ${clamped}`);
  return clamped;
}

export async function changeVolume(direction) {
  return setVolume(steppedVolume(await getVolume(), direction));
}

export async function toggleMute() {
  const muted = (await runOsascript('output muted of (get volume settings)')).trim() !== 'true';
  await runOsascript(`set volume output muted ${muted}`);
  return muted;
}
