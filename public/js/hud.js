import { send } from './session.js';

const VOLUME_LEVELS = 16; // matches the server's macOS volume steps
const HUD_VISIBLE_MS = 1200;

const SPEAKER = '<path d="M3 9v6h4l5 5V4L7 9H3z"/>';
const SPEAKER_LOUD = SPEAKER + '<path d="M15.5 12c0-1.3-.75-2.42-1.84-2.97v5.94c1.09-.55 1.84-1.67 1.84-2.97z"/>';
const SPEAKER_MUTED = SPEAKER + '<path d="M19 8l-5 5M14 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>';

const SUN_CORE = '<circle cx="12" cy="12" r="4" fill="currentColor"/>';
const sunRays = (lines) =>
  `<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${lines.map(
    ([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`,
  ).join('')}</g>`;
const SUN_RAYS_FAR = sunRays([
  [12, 1, 12, 3], [12, 21, 12, 23], [1, 12, 3, 12], [21, 12, 23, 12],
  [4.2, 4.2, 5.6, 5.6], [18.4, 18.4, 19.8, 19.8], [4.2, 19.8, 5.6, 18.4], [18.4, 5.6, 19.8, 4.2],
]);
const SUN_RAYS_NEAR = sunRays([
  [12, 3, 12, 4.5], [12, 19.5, 12, 21], [3, 12, 4.5, 12], [19.5, 12, 21, 12],
  [6, 6, 7, 7], [17, 17, 18, 18], [6, 18, 7, 17], [17, 7, 18, 6],
]);

/** Shows `hud` centered on the transport row, then fades it out. */
function createHud(hud) {
  const transportRow = document.getElementById('transportRow');
  let timer = null;
  return () => {
    const rect = transportRow.getBoundingClientRect();
    hud.style.top = `${rect.top + rect.height / 2 - hud.offsetHeight / 2}px`;
    hud.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => hud.classList.remove('visible'), HUD_VISIBLE_MS);
  };
}

export function initHud() {
  const volumeHud = document.getElementById('volumeHud');
  const volumeIcon = document.getElementById('volumeHudIcon');
  const volumeFill = document.getElementById('volumeHudFill');
  const revealVolumeHud = createHud(volumeHud);

  const dots = document.getElementById('volumeHudDots');
  for (let i = 0; i < VOLUME_LEVELS; i++) dots.appendChild(document.createElement('span'));

  function showVolume(percent) {
    volumeFill.style.width = `${percent}%`;
    volumeIcon.innerHTML = percent === 0 ? SPEAKER_MUTED : SPEAKER_LOUD;
    volumeHud.classList.remove('mute-only');
    revealVolumeHud();
  }

  function showMute(muted) {
    volumeIcon.innerHTML = muted ? SPEAKER_MUTED : SPEAKER_LOUD;
    volumeHud.classList.add('mute-only');
    revealVolumeHud();
  }

  const changeVolume = (action) => async () => {
    const data = await send(action);
    if (typeof data?.volume === 'number') showVolume(data.volume);
  };
  document.getElementById('volUp').onclick = changeVolume('volume/up');
  document.getElementById('volDown').onclick = changeVolume('volume/down');
  document.getElementById('muteBtn').onclick = async () => {
    const data = await send('mute');
    if (typeof data?.muted === 'boolean') showMute(data.muted);
  };

  // Brightness changes can't be read back, so only a single icon is shown.
  const brightnessIcon = document.getElementById('brightnessHudIcon');
  const revealBrightnessHud = createHud(document.getElementById('brightnessHud'));
  const changeBrightness = (action, up) => () => {
    send(action);
    brightnessIcon.innerHTML = SUN_CORE + (up ? SUN_RAYS_FAR : SUN_RAYS_NEAR);
    revealBrightnessHud();
  };
  document.getElementById('brightUp').onclick = changeBrightness('brightness/up', true);
  document.getElementById('brightDown').onclick = changeBrightness('brightness/down', false);
}
