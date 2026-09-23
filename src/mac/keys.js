import { runOsascript } from './osascript.js';

// macOS virtual key codes (ANSI layout). The space/* and mission-control keys
// mirror the three-finger trackpad swipes. The brightness codes are the legacy
// dedicated keys and have not been verified on every macOS version.
export const KEYS = {
  playpause: { code: 49 },
  rewind: { code: 123 },
  forward: { code: 124 },
  'space/prev': { code: 123, modifier: 'control down' },
  'space/next': { code: 124, modifier: 'control down' },
  'mission-control': { code: 126, modifier: 'control down' },
  'app-expose': { code: 125, modifier: 'control down' },
  'brightness/up': { code: 144 },
  'brightness/down': { code: 145 },
};

export function keyScript({ code, modifier }) {
  const using = modifier ? ` using {${modifier}}` : '';
  return `tell application "System Events" to key code ${code}${using}`;
}

export function pressKey(name) {
  const key = KEYS[name];
  if (!key) throw new Error(`unknown key: ${name}`);
  return runOsascript(keyScript(key));
}
