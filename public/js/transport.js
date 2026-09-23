import { send } from './session.js';
import { setHidden } from './util.js';

export function initTransport() {
  document.getElementById('rewind').onclick = () => send('rewind');
  document.getElementById('forward').onclick = () => send('forward');

  // The Mac's playback state can't be queried, so the icon is a local guess
  // that flips on each tap.
  const playButton = document.getElementById('playpause');
  const triangle = playButton.querySelector('.icon-triangle');
  const bars = playButton.querySelector('.icon-bars');
  let isPlaying = false;
  playButton.onclick = () => {
    send('playpause');
    isPlaying = !isPlaying;
    setHidden(triangle, isPlaying);
    setHidden(bars, !isPlaying);
  };
}
