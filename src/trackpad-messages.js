import { LIMITS } from './config.js';
import { clampDelta } from './util.js';

/** Handles one WebSocket text message: `move dx dy`, `scroll dy dx`, `click` or `end`. */
export function handleTrackpadMessage(text, input) {
  const [command, a, b] = text.split(' ');
  const ignore = () => {};

  if (command === 'move') {
    const delta = clampDelta(a, b, LIMITS.mouseMove);
    if (delta) input.move(...delta).catch(ignore);
  } else if (command === 'scroll') {
    const delta = clampDelta(a, b, LIMITS.scroll);
    if (delta) input.scroll(...delta).catch(ignore);
  } else if (command === 'click') {
    input.click().catch(ignore);
  } else if (command === 'end') {
    input.endDrag();
  }
}
