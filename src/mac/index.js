import { createInputDaemon } from './input-daemon.js';
import { pressKey } from './keys.js';
import { pullText } from './pull-text.js';
import { changeVolume, getVolume, toggleMute } from './volume.js';

/** Everything the server does to the Mac, behind one seam so tests can fake it. */
export function createMac({ daemonScript }) {
  const input = createInputDaemon({ script: daemonScript });
  return { input, pressKey, changeVolume, getVolume, toggleMute, pullText };
}
