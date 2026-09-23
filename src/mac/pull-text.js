import crypto from 'node:crypto';
import { LIMITS } from '../config.js';
import { readClipboard, writeClipboard } from './clipboard.js';
import { pressKey } from './keys.js';
import { runOsascript } from './osascript.js';

const COPY_ALL_SCRIPT = [
  'tell application "System Events"',
  'keystroke "a" using {command down}',
  'keystroke "c" using {command down}',
  'end tell',
].join('\n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the focused text field by sending Cmd+A / Cmd+C, then collapses the
 * selection so the caret ends up at the end of the text. A marker is placed on
 * the clipboard first so "nothing was copied" is distinguishable from "the
 * field matches the old clipboard"; the previous clipboard text is restored.
 */
export async function pullText() {
  const previous = await readClipboard();
  const marker = `__pocket_remote_${crypto.randomBytes(6).toString('hex')}__`;
  await writeClipboard(marker);
  try {
    await runOsascript(COPY_ALL_SCRIPT);
    let copied = marker;
    for (let attempt = 0; attempt < 10 && copied === marker; attempt++) {
      await sleep(50);
      copied = await readClipboard();
    }
    if (copied === marker) return '';
    await pressKey('forward'); // Right Arrow
    return copied.slice(-LIMITS.pullChars);
  } finally {
    await writeClipboard(previous);
  }
}
