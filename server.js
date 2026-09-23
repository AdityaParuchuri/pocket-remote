#!/usr/bin/env node
// Pocket Remote — play/pause/rewind/forward, volume, brightness, mute,
// window/Space switching, Mission Control/Exposé, a trackpad (with full
// 1/2/3-finger gesture support), a scroll column, and remote text typing —
// all controlling your laptop's frontmost app from your phone.
//
// Usage:
//   node server.js
// Then open the printed URL on your phone (same WiFi as this laptop).

const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4321;
const TOKEN_FILE = path.join(__dirname, '.token');
const MOUSE_SCRIPT = path.join(__dirname, 'scripts', 'mouse.js');
const MOUSE_MOVE_LIMIT = 800; // clamp per-request cursor delta (px)
const SCROLL_LIMIT = 2000; // clamp per-request scroll delta (px)

function getOrCreateToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    const token = crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(TOKEN_FILE, token);
    return token;
  }
}

const TOKEN = getOrCreateToken();

// macOS key codes (ANSI keyboard layout). "space/prev" and "space/next"
// mirror the three-finger horizontal trackpad swipe between full-screen
// apps/Spaces; "mission-control"/"app-expose" mirror a three-finger
// vertical swipe. "brightness/up" and "brightness/down" use the legacy
// dedicated brightness key codes — unlike every other action here, this
// hasn't been visually confirmed to actually change the screen brightness
// (there's no live-testable feedback from this environment), so if it
// turns out to be a no-op or backwards, it's a one-line fix.
const KEY_ACTIONS = {
  playpause: { code: 49 },              // space
  rewind: { code: 123 },                // left arrow
  forward: { code: 124 },               // right arrow
  'space/prev': { code: 123, modifier: 'control down' }, // ctrl+left
  'space/next': { code: 124, modifier: 'control down' }, // ctrl+right
  'mission-control': { code: 126, modifier: 'control down' }, // ctrl+up
  'app-expose': { code: 125, modifier: 'control down' },      // ctrl+down
  'brightness/up': { code: 144 },
  'brightness/down': { code: 145 },
};

function runOsascript(args) {
  return new Promise((resolve, reject) => {
    execFile('osascript', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function sendKey({ code, modifier }) {
  const script = modifier
    ? `tell application "System Events" to key code ${code} using {${modifier}}`
    : `tell application "System Events" to key code ${code}`;
  return runOsascript(['-e', script]);
}

function typeText(text) {
  const clean = String(text).slice(0, 500).replace(/[\r\n]/g, ' ');
  const escaped = clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return runOsascript(['-e', 'tell application "System Events" to keystroke "' + escaped + '"']);
}

// Mouse move/click/scroll go through a persistent JXA process instead of
// spawning a fresh `osascript` per event — spawn cost (tens of ms) was
// serializing and reordering trackpad updates during a drag, making the
// cursor lag far behind the finger. Commands are sent over a FIFO rather
// than the child's stdin pipe: Node puts stdio pipes in non-blocking mode,
// which would make the daemon's blocking read spin instead of wait; a FIFO
// opened by path doesn't have that problem.
const MOUSE_FIFO = path.join(os.tmpdir(), `pocket-remote-mouse-${process.pid}.fifo`);
let mouseDaemon = null;
let mouseFifoStream = null;

function startMouseDaemon() {
  try { fs.unlinkSync(MOUSE_FIFO); } catch {}
  execFile('mkfifo', [MOUSE_FIFO], (err) => {
    if (err) {
      console.error('mouse daemon: failed to create fifo:', err.message);
      setTimeout(startMouseDaemon, 1000);
      return;
    }

    const child = spawn('osascript', ['-l', 'JavaScript', MOUSE_SCRIPT, 'daemon', MOUSE_FIFO], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk) => {
      console.error('mouse daemon:', chunk.toString().trim());
    });
    child.on('exit', () => {
      if (mouseDaemon === child) mouseDaemon = null;
      if (mouseFifoStream) { mouseFifoStream.destroy(); mouseFifoStream = null; }
      setTimeout(startMouseDaemon, 500); // restart if it dies/is killed
    });
    mouseDaemon = child;

    const stream = fs.createWriteStream(MOUSE_FIFO);
    stream.on('error', () => {}); // surfaced via the child's exit + restart
    mouseFifoStream = stream;
  });
}

function mouseMove(dx, dy) {
  if (!mouseFifoStream) return Promise.reject(new Error('mouse control unavailable'));
  mouseFifoStream.write(`move ${dx} ${dy}\n`);
  return Promise.resolve();
}

function mouseClick() {
  if (!mouseFifoStream) return Promise.reject(new Error('mouse control unavailable'));
  mouseFifoStream.write('click\n');
  return Promise.resolve();
}

function mouseScroll(dy, dx) {
  if (!mouseFifoStream) return Promise.reject(new Error('mouse control unavailable'));
  mouseFifoStream.write(`scroll ${dy} ${dx}\n`);
  return Promise.resolve();
}

function mouseDragEnd() {
  if (mouseFifoStream) mouseFifoStream.write('end\n');
}

function stopMouseDaemon() {
  if (mouseFifoStream) mouseFifoStream.destroy();
  if (mouseDaemon) mouseDaemon.kill();
  try { fs.unlinkSync(MOUSE_FIFO); } catch {}
}

process.on('exit', stopMouseDaemon);
process.on('SIGINT', () => { stopMouseDaemon(); process.exit(0); });
process.on('SIGTERM', () => { stopMouseDaemon(); process.exit(0); });

// macOS's own volume HUD steps through 16 discrete levels (0-15), not an
// arbitrary +/-10 out of 100 — stepping by level index instead of a raw
// percentage keeps this in sync with what the physical volume keys do.
const VOLUME_LEVELS = 16;

function getSystemVolume() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'output volume of (get volume settings)'], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      const v = parseInt(stdout.trim(), 10);
      if (!Number.isFinite(v)) return reject(new Error('could not read volume'));
      resolve(v);
    });
  });
}

function setSystemVolume(v) {
  const clamped = Math.max(0, Math.min(100, Math.round(v)));
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', `set volume output volume ${clamped}`], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(clamped);
    });
  });
}

async function changeVolume(direction) {
  const cur = await getSystemVolume();
  const level = Math.round((cur / 100) * (VOLUME_LEVELS - 1));
  const nextLevel = Math.max(0, Math.min(VOLUME_LEVELS - 1, level + direction));
  const nextVolume = Math.round((nextLevel / (VOLUME_LEVELS - 1)) * 100);
  return setSystemVolume(nextVolume);
}

function getMuted() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'output muted of (get volume settings)'], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim() === 'true');
    });
  });
}

function setMuted(muted) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', `set volume output muted ${muted}`], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(muted);
    });
  });
}

async function toggleMute() {
  const cur = await getMuted();
  return setMuted(!cur);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e4) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

// Minimal WebSocket server (no deps) for the trackpad: one persistent
// connection avoids per-move HTTP request/response overhead (headers,
// JSON parsing, a fetch() call each time), which was the remaining source
// of lag once the mouse daemon removed the process-spawn cost.
const WS_MAGIC = '258EAFA65E914466B4A2E5C0DBF9EA46';

function wsAcceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

function wsParseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked) {
    const unmasked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
    payload = unmasked;
  }
  return { opcode, payload, frameLength: offset + len };
}

function wsEncodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function handleWsUpgrade(req, socket) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = req.headers['sec-websocket-key'];
  if (url.searchParams.get('token') !== TOKEN || !key) {
    socket.destroy();
    return;
  }
  // Without this, Nagle's algorithm can hold each small move frame for up
  // to ~40ms waiting to coalesce with more outgoing data, which shows up
  // as periodic stutter rather than a smooth stream of moves.
  socket.setNoDelay(true);
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${wsAcceptKey(key)}`,
    '\r\n',
  ].join('\r\n'));

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = wsParseFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.frameLength);

      if (frame.opcode === 0x8) { // close
        socket.end(wsEncodeFrame(0x8, Buffer.alloc(0)));
        return;
      } else if (frame.opcode === 0x9) { // ping
        socket.write(wsEncodeFrame(0xA, frame.payload));
      } else if (frame.opcode === 0x1) { // text
        const parts = frame.payload.toString('utf8').split(' ');
        if (parts[0] === 'move') {
          const dx = Math.max(-MOUSE_MOVE_LIMIT, Math.min(MOUSE_MOVE_LIMIT, Number(parts[1])));
          const dy = Math.max(-MOUSE_MOVE_LIMIT, Math.min(MOUSE_MOVE_LIMIT, Number(parts[2])));
          if (Number.isFinite(dx) && Number.isFinite(dy)) mouseMove(dx, dy);
        } else if (parts[0] === 'click') {
          mouseClick();
        } else if (parts[0] === 'scroll') {
          const dy = Math.max(-SCROLL_LIMIT, Math.min(SCROLL_LIMIT, Number(parts[1])));
          const dx = Math.max(-SCROLL_LIMIT, Math.min(SCROLL_LIMIT, Number(parts[2])));
          if (Number.isFinite(dy) && Number.isFinite(dx)) mouseScroll(dy, dx);
        } else if (parts[0] === 'end') {
          mouseDragEnd();
        }
      }
    }
  });
  socket.on('error', () => {});
}

function getLanUrls() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}/?token=${TOKEN}`);
      }
    }
  }
  return urls;
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Pocket Remote</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html { overscroll-behavior-y: contain; }
  html, body {
    height: 100%; margin: 0;
    background: #0b0b0d; color: #f2f2f2;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body {
    display: flex; flex-direction: column; align-items: center;
    gap: 16px;
    height: 100vh;
    height: 100dvh;
    padding: 40px 24px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  #app {
    display: flex; flex-direction: column; align-items: center;
    gap: 18px; flex: 1; min-height: 0; width: 100%; max-width: 380px;
  }
  .title { font-size: 20px; font-weight: 700; margin: 0; }
  .row { display: flex; align-items: center; justify-content: center; gap: 16px; }
  button { border: none; background: none; color: inherit; font: inherit; padding: 0; transition: transform 0.08s ease, background 0.08s ease, opacity 0.08s ease; }

  .circle-btn {
    border-radius: 22px; background: #1c1c1f; color: #f2f2f2;
    display: flex; align-items: center; justify-content: center;
    width: 96px; height: 96px; font-size: 30px;
    transition: transform 0.08s ease, background 0.08s ease;
  }
  .circle-btn:active { transform: scale(0.92); background: #2c2c31; }
  .circle-btn.play { border-radius: 48px; background: #2563eb; }
  .circle-btn.play:active { background: #1d4ed8; }
  /* CSS-drawn play/pause glyphs instead of Unicode symbols — characters
     like the media-control emoji tend to render with their own colored
     background tile on iOS (emoji presentation), which a plain shape
     doesn't have. */
  .icon-triangle {
    width: 0; height: 0; margin-left: 6px;
    border-top: 13px solid transparent; border-bottom: 13px solid transparent;
    border-left: 22px solid #f2f2f2;
  }
  .icon-bars:not([hidden]) { display: flex; gap: 7px; }
  .icon-bars span { width: 7px; height: 26px; background: #f2f2f2; border-radius: 2px; }

  .pill {
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    width: 64px; height: 160px; border-radius: 32px; background: #1c1c1f;
    padding: 18px 0; user-select: none;
  }
  .pill button {
    width: calc(100% - 16px); margin: 0 8px; display: flex; align-items: center; justify-content: center;
    font-size: 22px; height: 34px; border-radius: 12px;
  }
  .pill button:active { background: rgba(255,255,255,0.16); transform: scale(0.9); }
  .pill .label { font-size: 11px; letter-spacing: 0.06em; color: #9a9a9f; text-transform: uppercase; }

  .mute-btn {
    width: 56px; height: 56px; border-radius: 28px; background: #dc2626; color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 22px;
  }
  .mute-btn:active { background: #b91c1c; transform: scale(0.9); }

  #padRow { display: flex; gap: 12px; flex: 1; min-height: 140px; width: 100%; }
  #trackpad {
    flex: 1; border-radius: 20px; background: #2c2d30;
    touch-action: none; user-select: none;
  }
  #trackpad.active { background: #232427; }
  #scrollPill {
    width: 40px; border-radius: 20px; background: #1c1c1f; color: #f2f2f2;
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    padding: 16px 0; touch-action: none; user-select: none;
  }
  #scrollPill span { font-size: 18px; width: 100%; text-align: center; }
  #scrollPill.active { background: #2c2c31; }

  #footerRow { display: flex; gap: 12px; width: 100%; }
  #dotsBar {
    flex: 1; height: 40px; border-radius: 20px; background: #1c1c1f;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    touch-action: none; user-select: none;
  }
  #dotsBar { transition: background 0.08s ease; }
  #dotsBar.active { background: #2c2c31; }
  #dotsBar .chevron { font-size: 13px; color: #6a6a70; line-height: 1; }
  #dotsBar .dot { width: 8px; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.4); }
  #dotsBar .dot:nth-child(3) { background: rgba(255,255,255,0.15); }
  #keyboardIcon {
    width: 40px; height: 40px; border-radius: 12px; background: #55565A; color: #f2f2f2;
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  #keyboardIcon:active { opacity: 0.7; transform: scale(0.9); }

  #status {
    position: fixed; top: 12px; left: 0; right: 0; text-align: center;
    font-size: 13px; color: #ff6b6b; min-height: 18px; padding: 0 24px; z-index: 10;
  }
  #tokenBox { display: none; flex-direction: column; gap: 12px; align-items: center; }
  #tokenBox input {
    background: #1c1c1f; border: 1px solid #2a2a2e; color: #f2f2f2;
    padding: 12px 14px; border-radius: 10px; font-size: 16px; width: 220px; text-align: center;
  }
  #tokenBox button.save { padding: 12px 20px; border-radius: 10px; font-size: 15px; background: #1c1c1f; }
  #tokenBox button.save:active { background: #2c2c31; transform: scale(0.95); }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: none; align-items: flex-end; z-index: 20;
  }
  .overlay.visible { display: flex; }
  .overlay-content {
    width: 100%; background: #16161a; border-radius: 20px 20px 0 0;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    display: flex; flex-direction: column; gap: 12px; margin: 0;
  }
  .overlay-content input {
    background: #1c1c1f; border: 1px solid #2a2a2e; color: #f2f2f2;
    padding: 14px; border-radius: 10px; font-size: 16px;
  }
  .overlay-actions { display: flex; gap: 10px; }
  .overlay-actions button { flex: 1; padding: 12px; border-radius: 10px; font-size: 15px; background: #2563eb; color: #fff; text-align: center; }
  .overlay-actions button:active { transform: scale(0.95); }
  .overlay-actions button[type="submit"]:active { background: #1d4ed8; }
  .overlay-actions button#keyboardClose { background: #2c2c31; color: #f2f2f2; }
  .overlay-actions button#keyboardClose:active { background: #3a3a3f; }

  /* Classic macOS volume OSD: a wide horizontal pill, small/large speaker
     icons flanking a level line, with tick dots below it. Briefly shown
     and faded on change. */
  .hud {
    position: fixed; top: 64px; left: 50%; transform: translateX(-50%) scale(0.92);
    width: min(300px, 82vw); padding: 16px 20px; box-sizing: border-box;
    background: rgba(28,28,31,0.88); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-radius: 14px;
    display: flex; align-items: center; gap: 12px;
    opacity: 0; pointer-events: none; z-index: 30;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .hud.visible { opacity: 1; transform: translateX(-50%) scale(1); }
  .hud-icon-small { flex: none; width: 14px; height: 14px; color: #9a9a9f; }
  .hud-icon-large { flex: none; color: #f2f2f2; }
  .hud-icon-large svg:not([hidden]) { width: 18px; height: 18px; display: block; }
  .mute-btn svg { width: 24px; height: 24px; }
  .hud-track { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .hud-line { position: relative; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.22); overflow: hidden; }
  .hud-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #f2f2f2; }
  .hud-dots { display: flex; justify-content: space-between; padding: 0 1px; }
  .hud-dots span { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.3); }
</style>
</head>
<body>
  <div id="status"></div>
  <div id="app">
    <h1 class="title">Pocket Remote</h1>

    <div class="row">
      <button class="circle-btn" id="rewind" aria-label="Rewind">↺</button>
      <button class="circle-btn play" id="playpause" aria-label="Play/Pause">
        <span class="icon-triangle"></span>
        <span class="icon-bars" hidden><span></span><span></span></span>
      </button>
      <button class="circle-btn" id="forward" aria-label="Forward">↻</button>
    </div>

    <div class="row">
      <div class="pill" id="volumePill">
        <button id="volUp" aria-label="Volume up">+</button>
        <span class="label">Vol</span>
        <button id="volDown" aria-label="Volume down">−</button>
      </div>
      <button class="mute-btn" id="muteBtn" aria-label="Mute">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M19 8l-5 5M14 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>
      </button>
      <div class="pill" id="brightnessPill">
        <button id="brightUp" aria-label="Brightness up">▲</button>
        <span class="label">Bright</span>
        <button id="brightDown" aria-label="Brightness down">▼</button>
      </div>
    </div>

    <div id="padRow">
      <div id="trackpad"></div>
      <div id="scrollPill">
        <span id="scrollUp" aria-hidden="true">↑</span>
        <span id="scrollDown" aria-hidden="true">↓</span>
      </div>
    </div>

    <div id="footerRow">
      <div id="dotsBar" aria-label="Swipe to switch window">
        <span class="chevron" aria-hidden="true">&lt;</span>
        <span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="chevron" aria-hidden="true">&gt;</span>
      </div>
      <button id="keyboardIcon" aria-label="Type text">⌨</button>
    </div>
  </div>

  <div id="tokenBox">
    <input id="tokenInput" placeholder="Paste remote token" autocapitalize="off" autocorrect="off">
    <button class="save" id="tokenSave">Save</button>
  </div>

  <div id="keyboardOverlay" class="overlay">
    <form id="keyboardForm" class="overlay-content">
      <input id="keyboardInput" type="text" placeholder="Type to send..." autocapitalize="off" autocorrect="off" autocomplete="off">
      <div class="overlay-actions">
        <button type="submit">Send</button>
        <button type="button" id="keyboardClose">Close</button>
      </div>
    </form>
  </div>

  <div id="volumeHud" class="hud">
    <span class="hud-icon-small">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M15.5 12c0-1.3-.75-2.42-1.84-2.97v5.94c1.09-.55 1.84-1.67 1.84-2.97z"/></svg>
    </span>
    <div class="hud-track">
      <div class="hud-line"><div class="hud-fill" id="volumeHudFill"></div></div>
      <div class="hud-dots" id="volumeHudDots"></div>
    </div>
    <span class="hud-icon-large">
      <svg id="volumeHudIconLoud" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M15.5 12c0-1.3-.75-2.42-1.84-2.97v5.94c1.09-.55 1.84-1.67 1.84-2.97z"/><path d="M14 5.23v2.06c2.39.72 4.14 2.94 4.14 5.58s-1.75 4.86-4.14 5.58v2.06c3.49-.77 6.1-3.9 6.1-7.64s-2.61-6.87-6.1-7.64z"/></svg>
      <svg id="volumeHudIconMuted" viewBox="0 0 24 24" fill="currentColor" hidden><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M19 8l-5 5M14 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>
    </span>
  </div>

<script>
  // iOS Safari doesn't apply :active CSS at all unless something on the
  // page has a touch listener — this no-op is the standard fix, and it's
  // what makes every plain button's press feedback below actually show up.
  document.body.addEventListener('touchstart', function () {}, { passive: true });

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate(15);
  }

  const params = new URLSearchParams(location.search);
  let token = params.get('token') || localStorage.getItem('remoteToken') || '';
  if (params.get('token')) localStorage.setItem('remoteToken', token);

  const statusEl = document.getElementById('status');
  const appEl = document.getElementById('app');
  const tokenBox = document.getElementById('tokenBox');

  function showTokenPrompt() {
    appEl.style.display = 'none';
    tokenBox.style.display = 'flex';
  }

  document.getElementById('tokenSave').onclick = () => {
    token = document.getElementById('tokenInput').value.trim();
    if (token) {
      localStorage.setItem('remoteToken', token);
      tokenBox.style.display = 'none';
      appEl.style.display = 'flex';
      statusEl.textContent = '';
      connectWs();
    }
  };

  function flash(msg, ms, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#ff6b6b' : '#9a9a9f';
    if (ms) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, ms);
  }

  // Trackpad moves/clicks/scrolls go over a persistent WebSocket when
  // available — avoids per-move HTTP request/response overhead. Falls back
  // to the regular fetch() API if the socket isn't open yet.
  let ws = null;
  let wsReconnectDelay = 500;

  function connectWs() {
    if (!token) return;
    ws = new WebSocket('ws://' + location.host + '/ws?token=' + encodeURIComponent(token));
    ws.onopen = () => { wsReconnectDelay = 500; };
    ws.onclose = () => {
      ws = null;
      setTimeout(connectWs, wsReconnectDelay);
      wsReconnectDelay = Math.min(wsReconnectDelay * 2, 5000);
    };
    ws.onerror = () => { ws.close(); };
  }

  function sendWs(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      return true;
    }
    return false;
  }

  async function send(action, body) {
    if (!token) { showTokenPrompt(); return null; }
    try {
      const res = await fetch('/api/' + action, {
        method: 'POST',
        headers: Object.assign({ 'x-remote-token': token }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 403) {
        flash('Invalid token', 3000, true);
        showTokenPrompt();
        return null;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(data.error || 'Command failed', 4000, true);
        return null;
      }
      vibrate();
      return data;
    } catch (e) {
      flash('Cannot reach laptop', 3000, true);
      return null;
    }
  }

  if (!token) showTokenPrompt();
  else connectWs();

  // --- Transport ---
  document.getElementById('rewind').onclick = () => send('rewind');
  document.getElementById('forward').onclick = () => send('forward');

  // There's no way to query the Mac's actual playback state from here, so
  // this just flips a local best-guess icon on each tap alongside the real
  // command — imperfect if playback is also controlled another way, but
  // clearer than a single ambiguous combined glyph.
  const playBtn = document.getElementById('playpause');
  const playTriangle = playBtn.querySelector('.icon-triangle');
  const playBars = playBtn.querySelector('.icon-bars');
  let isPlaying = false;
  playBtn.onclick = () => {
    send('playpause');
    isPlaying = !isPlaying;
    playTriangle.hidden = isPlaying;
    playBars.hidden = !isPlaying;
  };

  // --- Volume / mute / brightness ---
  // Classic macOS volume OSD: a level line (fill % = volume) with tick
  // dots below it matching the Mac's own 16-level volume steps (kept in
  // sync with VOLUME_LEVELS on the server), briefly shown and faded.
  const VOLUME_HUD_LEVELS = 16;
  const volumeHud = document.getElementById('volumeHud');
  const volumeHudIconLoud = document.getElementById('volumeHudIconLoud');
  const volumeHudIconMuted = document.getElementById('volumeHudIconMuted');
  const volumeHudFill = document.getElementById('volumeHudFill');
  const volumeHudDots = document.getElementById('volumeHudDots');
  for (let i = 0; i < VOLUME_HUD_LEVELS; i++) volumeHudDots.appendChild(document.createElement('span'));
  let volumeHudTimer = null;

  function showVolumeHud(percent, muted) {
    volumeHudFill.style.width = (muted ? 0 : percent) + '%';
    const isMuted = muted || percent === 0;
    volumeHudIconLoud.hidden = isMuted;
    volumeHudIconMuted.hidden = !isMuted;
    volumeHud.classList.add('visible');
    clearTimeout(volumeHudTimer);
    volumeHudTimer = setTimeout(() => volumeHud.classList.remove('visible'), 1200);
  }

  document.getElementById('volUp').onclick = async () => {
    const data = await send('volume/up');
    if (data && typeof data.volume === 'number') showVolumeHud(data.volume, false);
  };
  document.getElementById('volDown').onclick = async () => {
    const data = await send('volume/down');
    if (data && typeof data.volume === 'number') showVolumeHud(data.volume, false);
  };
  document.getElementById('muteBtn').onclick = async () => {
    const data = await send('mute');
    if (data && typeof data.muted === 'boolean') showVolumeHud(data.volume || 0, data.muted);
  };
  document.getElementById('brightUp').onclick = () => { send('brightness/up'); flash('Brightness up', 1000, false); };
  document.getElementById('brightDown').onclick = () => { send('brightness/down'); flash('Brightness down', 1000, false); };

  // --- Trackpad: full 1/2/3-finger gesture support, emulating a MacBook
  // trackpad — 1 finger drags the cursor and taps to click, 2 fingers
  // scroll (natural direction: content follows your finger), 3 fingers
  // swipe horizontally to switch windows/Spaces or vertically for Mission
  // Control (up) / App Exposé (down). Mode is decided by the highest
  // finger count seen and never downgrades mid-gesture, matching how a
  // real trackpad behaves. ---
  const trackpad = document.getElementById('trackpad');
  const SENSITIVITY = 1.6;
  const SCROLL_SENSITIVITY = 1.2;
  const SWIPE_THRESHOLD = 40;
  const TAP_MAX_MS = 300;
  const TAP_MAX_MOVE = 8;

  function centroid(touches) {
    let x = 0, y = 0;
    for (let i = 0; i < touches.length; i++) { x += touches[i].clientX; y += touches[i].clientY; }
    return { x: x / touches.length, y: y / touches.length };
  }

  let touchState = null;

  function sendMove(dx, dy) {
    if (dx === 0 && dy === 0) return;
    if (!sendWs('move ' + dx + ' ' + dy)) send('mouse/move', { dx, dy });
  }

  // Positive dy scrolls content down (traditional convention); a 2-finger
  // drag up should feel like natural scrolling (content follows the
  // finger), so its sign is inverted before it reaches here.
  function sendScroll(dy, dx) {
    if (dy === 0 && dx === 0) return;
    if (!sendWs('scroll ' + dy + ' ' + dx)) send('mouse/scroll', { dx, dy });
  }

  function endTracking() {
    trackpad.classList.remove('active');
    if (touchState && touchState.mode === 'pointer') {
      if (!sendWs('end')) send('mouse/end');
    }
  }

  trackpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    trackpad.classList.add('active');
    const fingers = e.touches.length;
    const c = centroid(e.touches);
    if (!touchState) {
      touchState = {
        mode: fingers === 1 ? 'pointer' : (fingers === 2 ? 'scroll' : 'gesture'),
        startX: c.x, startY: c.y, lastX: c.x, lastY: c.y,
        startTime: Date.now(), moved: false, maxFingers: fingers,
      };
    } else {
      touchState.maxFingers = Math.max(touchState.maxFingers, fingers);
      if (touchState.mode === 'pointer' && fingers >= 2) {
        if (!sendWs('end')) send('mouse/end');
      }
      if (fingers >= 3) touchState.mode = 'gesture';
      else if (fingers === 2 && touchState.mode !== 'gesture') touchState.mode = 'scroll';
      touchState.lastX = c.x;
      touchState.lastY = c.y;
    }
  }, { passive: false });

  trackpad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!touchState) return;
    const fingers = e.touches.length;
    touchState.maxFingers = Math.max(touchState.maxFingers, fingers);
    const c = centroid(e.touches);
    const dx = c.x - touchState.lastX;
    const dy = c.y - touchState.lastY;

    if (touchState.mode === 'pointer' && fingers === 1) {
      sendMove(dx * SENSITIVITY, dy * SENSITIVITY);
    } else if (touchState.mode === 'scroll' && fingers === 2) {
      sendScroll(-dy * SCROLL_SENSITIVITY, -dx * SCROLL_SENSITIVITY);
    }
    // mode === 'gesture' (3+ fingers): no continuous action, just track
    // position for the discrete swipe decision made at touchend.

    touchState.lastX = c.x;
    touchState.lastY = c.y;
    if (Math.abs(c.x - touchState.startX) > TAP_MAX_MOVE || Math.abs(c.y - touchState.startY) > TAP_MAX_MOVE) {
      touchState.moved = true;
    }
  }, { passive: false });

  trackpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!touchState) return;
    if (e.touches.length > 0) {
      // Some fingers lifted but the gesture continues with the rest —
      // resync the centroid baseline so it doesn't jump when recomputed
      // over the smaller set of remaining touches.
      const c = centroid(e.touches);
      touchState.lastX = c.x;
      touchState.lastY = c.y;
      return;
    }

    const elapsed = Date.now() - touchState.startTime;
    const totalDx = touchState.lastX - touchState.startX;
    const totalDy = touchState.lastY - touchState.startY;
    const mode = touchState.mode;
    const maxFingers = touchState.maxFingers;
    endTracking();

    if (mode === 'gesture' && maxFingers >= 3) {
      if (Math.abs(totalDx) > SWIPE_THRESHOLD && Math.abs(totalDx) > Math.abs(totalDy)) {
        send(totalDx < 0 ? 'space/next' : 'space/prev');
      } else if (Math.abs(totalDy) > SWIPE_THRESHOLD && Math.abs(totalDy) > Math.abs(totalDx)) {
        send(totalDy < 0 ? 'mission-control' : 'app-expose');
      }
    } else if (mode === 'pointer' && maxFingers === 1 && !touchState.moved && elapsed < TAP_MAX_MS) {
      if (!sendWs('click')) send('mouse/click');
      else vibrate();
    }
    touchState = null;
  }, { passive: false });

  trackpad.addEventListener('touchcancel', () => {
    endTracking();
    touchState = null;
  }, { passive: false });

  // --- Scroll pill: tap the top/bottom half for a discrete nudge, or drag
  // anywhere on it for continuous scrolling — same sign convention as the
  // 2-finger trackpad scroll above, and same "let a small tap-vs-drag
  // threshold decide" pattern the trackpad already uses. ---
  const scrollPill = document.getElementById('scrollPill');
  const SCROLL_NUDGE = 80;
  const SCROLL_TAP_MAX_MS = 300;
  const SCROLL_TAP_MAX_MOVE = 6;
  let scrollDrag = null;

  scrollPill.addEventListener('touchstart', (e) => {
    e.preventDefault();
    scrollPill.classList.add('active');
    const t = e.touches[0];
    scrollDrag = { startY: t.clientY, lastY: t.clientY, startTime: Date.now(), moved: false };
  }, { passive: false });

  scrollPill.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!scrollDrag) return;
    const t = e.touches[0];
    const dy = t.clientY - scrollDrag.lastY;
    if (Math.abs(t.clientY - scrollDrag.startY) > SCROLL_TAP_MAX_MOVE) scrollDrag.moved = true;
    if (scrollDrag.moved) sendScroll(-dy * SCROLL_SENSITIVITY, 0);
    scrollDrag.lastY = t.clientY;
  }, { passive: false });

  scrollPill.addEventListener('touchend', (e) => {
    e.preventDefault();
    scrollPill.classList.remove('active');
    if (!scrollDrag) return;
    const elapsed = Date.now() - scrollDrag.startTime;
    if (!scrollDrag.moved && elapsed < SCROLL_TAP_MAX_MS) {
      const rect = scrollPill.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      sendScroll(scrollDrag.startY < mid ? -SCROLL_NUDGE : SCROLL_NUDGE, 0);
      vibrate();
    }
    scrollDrag = null;
  }, { passive: false });

  scrollPill.addEventListener('touchcancel', () => {
    scrollPill.classList.remove('active');
    scrollDrag = null;
  }, { passive: false });

  // --- Dots bar: purely decorative, but swiping it left/right switches
  // windows/Spaces, same as the trackpad's 3-finger horizontal swipe. ---
  const dotsBar = document.getElementById('dotsBar');
  let dotsSwipe = null;
  dotsBar.addEventListener('touchstart', (e) => {
    e.preventDefault();
    dotsBar.classList.add('active');
    const t = e.touches[0];
    dotsSwipe = { startX: t.clientX, startY: t.clientY };
  }, { passive: false });
  dotsBar.addEventListener('touchend', (e) => {
    e.preventDefault();
    dotsBar.classList.remove('active');
    if (!dotsSwipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - dotsSwipe.startX;
    const dy = t.clientY - dotsSwipe.startY;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy)) {
      send(dx < 0 ? 'space/next' : 'space/prev');
    }
    dotsSwipe = null;
  }, { passive: false });
  dotsBar.addEventListener('touchcancel', () => {
    dotsBar.classList.remove('active');
    dotsSwipe = null;
  }, { passive: false });

  // --- Keyboard overlay: type on the phone, send as keystrokes to the Mac ---
  const keyboardOverlay = document.getElementById('keyboardOverlay');
  const keyboardInput = document.getElementById('keyboardInput');

  document.getElementById('keyboardIcon').onclick = () => {
    keyboardOverlay.classList.add('visible');
    keyboardInput.value = '';
    keyboardInput.focus();
  };
  document.getElementById('keyboardClose').onclick = () => {
    keyboardOverlay.classList.remove('visible');
    keyboardInput.blur();
  };
  document.getElementById('keyboardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = keyboardInput.value;
    if (!text) return;
    await send('keyboard/type', { text });
    keyboardInput.value = '';
    keyboardInput.focus();
  });
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(PAGE);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const suppliedToken = req.headers['x-remote-token'];
    if (suppliedToken !== TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }

    const action = url.pathname.slice('/api/'.length);

    try {
      const extra = {};
      if (action === 'mouse/move') {
        const body = await readJsonBody(req);
        const clamp = (v) => Math.max(-MOUSE_MOVE_LIMIT, Math.min(MOUSE_MOVE_LIMIT, v));
        const dx = Number(body.dx), dy = Number(body.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('invalid dx/dy');
        await mouseMove(clamp(dx), clamp(dy));
      } else if (action === 'mouse/click') {
        await mouseClick();
      } else if (action === 'mouse/scroll') {
        const body = await readJsonBody(req);
        const clamp = (v) => Math.max(-SCROLL_LIMIT, Math.min(SCROLL_LIMIT, v));
        const dx = Number(body.dx), dy = Number(body.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('invalid dx/dy');
        await mouseScroll(clamp(dy), clamp(dx));
      } else if (action === 'mouse/end') {
        mouseDragEnd();
      } else if (action === 'volume/up') {
        extra.volume = await changeVolume(1);
      } else if (action === 'volume/down') {
        extra.volume = await changeVolume(-1);
      } else if (action === 'mute') {
        extra.muted = await toggleMute();
        extra.volume = await getSystemVolume();
      } else if (action === 'keyboard/type') {
        const body = await readJsonBody(req);
        if (typeof body.text !== 'string' || !body.text) throw new Error('missing text');
        await typeText(body.text);
      } else if (KEY_ACTIONS[action]) {
        await sendKey(KEY_ACTIONS[action]);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown action' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({ ok: true }, extra)));
    } catch (err) {
      const msg = /not allowed to send keystrokes|assistive access|not allowed assistive/i.test(err.message)
        ? 'Grant Accessibility permission to Terminal in System Settings → Privacy & Security → Accessibility'
        : err.message;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, `http://${req.headers.host}`).pathname === '/ws') {
    handleWsUpgrade(req, socket);
  } else {
    socket.destroy();
  }
});

startMouseDaemon();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pocket Remote running on port ${PORT}\n`);
  console.log('Open one of these on your phone (same WiFi):\n');
  for (const url of getLanUrls()) console.log('  ' + url);
  console.log(`\nToken: ${TOKEN} (saved in .token, reused across restarts)`);
});
