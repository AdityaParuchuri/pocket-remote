#!/usr/bin/env node
// Pocket Remote — play/pause/rewind/forward, switch windows, and a
// trackpad, all controlling your laptop's frontmost app from your phone.
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
// mirror the three-finger trackpad swipe between full-screen apps/Spaces.
const KEY_ACTIONS = {
  playpause: { code: 49 },              // space
  rewind: { code: 123 },                // left arrow
  forward: { code: 124 },               // right arrow
  'space/prev': { code: 123, modifier: 'control down' }, // ctrl+left
  'space/next': { code: 124, modifier: 'control down' }, // ctrl+right
};

function runOsascript(args) {
  return new Promise((resolve, reject) => {
    execFile('osascript', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

function sendKey({ code, modifier }) {
  const script = modifier
    ? `tell application "System Events" to key code ${code} using {${modifier}}`
    : `tell application "System Events" to key code ${code}`;
  return runOsascript(['-e', script]);
}

// Mouse move/click go through a persistent JXA process instead of spawning
// a fresh `osascript` per event — spawn cost (tens of ms) was serializing
// and reordering trackpad updates during a drag, making the cursor lag far
// behind the finger. Commands are sent over a FIFO rather than the child's
// stdin pipe: Node puts stdio pipes in non-blocking mode, which would make
// the daemon's blocking read spin instead of wait; a FIFO opened by path
// doesn't have that problem.
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

const VOLUME_STEP = 10;

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

async function changeVolume(delta) {
  const cur = await getSystemVolume();
  return setSystemVolume(cur + delta);
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
    gap: 14px;
    height: 100vh;
    height: 100dvh;
    padding: 50px 24px calc(20px + env(safe-area-inset-bottom, 0px));
  }
  #app {
    display: flex; flex-direction: column; align-items: center;
    gap: 14px; flex: 1; min-height: 0; width: 100%;
  }
  h1 {
    font-size: 13px; font-weight: 600; color: #7a7a80; margin: 18px 0 2px;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  h1:first-of-type { margin-top: 0; }
  .row { display: flex; align-items: center; justify-content: center; gap: 20px; }
  button {
    border: none; border-radius: 28px; background: #1c1c1f; color: #f2f2f2;
    display: flex; align-items: center; justify-content: center;
    width: 96px; height: 96px; font-size: 34px;
    box-shadow: 0 0 0 1px #2a2a2e inset;
    transition: transform 0.08s ease, background 0.08s ease;
  }
  button:active { transform: scale(0.92); background: #2c2c31; }
  .play { width: 128px; height: 128px; border-radius: 50%; font-size: 44px; background: #2563eb; box-shadow: none; }
  .play:active { background: #1d4ed8; }
  .small { width: 76px; height: 76px; font-size: 26px; border-radius: 22px; }
  #trackpad {
    width: min(340px, 100%); flex: 1; min-height: 140px; border-radius: 20px;
    background: #16161a; box-shadow: 0 0 0 1px #2a2a2e inset;
    display: flex; align-items: center; justify-content: center;
    color: #55555c; font-size: 13px; text-align: center; padding: 16px;
    touch-action: none; user-select: none; line-height: 1.6;
  }
  #trackpad.active { background: #1c1c22; }
  #status {
    position: fixed; top: 16px; left: 0; right: 0; text-align: center;
    font-size: 13px; color: #ff6b6b; min-height: 18px; padding: 0 24px; z-index: 10;
  }
  #tokenBox { display: none; flex-direction: column; gap: 12px; align-items: center; }
  #tokenBox input {
    background: #1c1c1f; border: 1px solid #2a2a2e; color: #f2f2f2;
    padding: 12px 14px; border-radius: 10px; font-size: 16px; width: 220px; text-align: center;
  }
  #tokenBox button { width: auto; height: auto; padding: 12px 20px; border-radius: 10px; font-size: 15px; }
</style>
</head>
<body>
  <div id="status"></div>
  <div id="app">
    <h1>Pocket Remote</h1>
    <div class="row">
      <button id="rewind" aria-label="Rewind">⏪</button>
      <button id="playpause" class="play" aria-label="Play/Pause">⏯</button>
      <button id="forward" aria-label="Forward">⏩</button>
    </div>

    <h1>Switch Window</h1>
    <div class="row">
      <button class="small" id="spacePrev" aria-label="Previous window">⇠</button>
      <button class="small" id="spaceNext" aria-label="Next window">⇢</button>
    </div>

    <h1>Volume</h1>
    <div class="row">
      <button class="small" id="volDown" aria-label="Volume down">🔉</button>
      <button class="small" id="volUp" aria-label="Volume up">🔊</button>
    </div>

    <h1>Trackpad</h1>
    <div id="trackpad">Drag to move · tap to click<br>3-finger swipe to switch window</div>
  </div>
  <div id="tokenBox">
    <input id="tokenInput" placeholder="Paste remote token" autocapitalize="off" autocorrect="off">
    <button id="tokenSave">Save</button>
  </div>
<script>
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
      appEl.style.display = 'block';
      statusEl.textContent = '';
      connectWs();
    }
  };

  function flash(msg, ms = 2000, isError = true) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#ff6b6b' : '#9a9a9f';
    if (ms) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ''; }, ms);
  }

  // Trackpad moves/clicks go over a persistent WebSocket when available —
  // avoids per-move HTTP request/response overhead. Falls back to the
  // regular fetch() API if the socket isn't open yet.
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
        flash('Invalid token', 3000);
        showTokenPrompt();
        return null;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(data.error || 'Command failed', 4000);
        return null;
      }
      if (navigator.vibrate) navigator.vibrate(15);
      return data;
    } catch (e) {
      flash('Cannot reach laptop', 3000);
      return null;
    }
  }

  if (!token) showTokenPrompt();
  else connectWs();

  document.getElementById('rewind').onclick = () => send('rewind');
  document.getElementById('playpause').onclick = () => send('playpause');
  document.getElementById('forward').onclick = () => send('forward');
  document.getElementById('spacePrev').onclick = () => send('space/prev');
  document.getElementById('spaceNext').onclick = () => send('space/next');
  document.getElementById('volDown').onclick = async () => {
    const data = await send('volume/down');
    if (data && typeof data.volume === 'number') flash('Volume ' + data.volume + '%', 1500, false);
  };
  document.getElementById('volUp').onclick = async () => {
    const data = await send('volume/up');
    if (data && typeof data.volume === 'number') flash('Volume ' + data.volume + '%', 1500, false);
  };

  // --- Trackpad: drag to move cursor, tap to click, 3-finger swipe to switch window ---
  const trackpad = document.getElementById('trackpad');
  const SENSITIVITY = 1.6;
  const SWIPE_THRESHOLD = 40;
  const TAP_MAX_MS = 300;
  const TAP_MAX_MOVE = 8;

  let touchState = null;

  // Each touchmove is sent as soon as it happens rather than batched onto a
  // setInterval tick — batching decoupled send timing from actual touch
  // events, and JS timer jitter under load turned that into uneven, bursty
  // movement. Now that a move is a single cheap WebSocket frame, 1:1 is
  // both simpler and smoother.
  function sendMove(dx, dy) {
    if (dx === 0 && dy === 0) return;
    if (!sendWs('move ' + dx + ' ' + dy)) send('mouse/move', { dx, dy });
  }

  function endTracking() {
    trackpad.classList.remove('active');
    if (!sendWs('end')) send('mouse/end');
  }

  trackpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    trackpad.classList.add('active');
    const t = e.touches[0];
    touchState = {
      startX: t.clientX, startY: t.clientY,
      lastX: t.clientX, lastY: t.clientY,
      startTime: Date.now(),
      maxFingers: e.touches.length,
      moved: false,
    };
  }, { passive: false });

  trackpad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!touchState) return;
    touchState.maxFingers = Math.max(touchState.maxFingers, e.touches.length);
    const t = e.touches[0];
    if (e.touches.length < 3) {
      const dx = (t.clientX - touchState.lastX) * SENSITIVITY;
      const dy = (t.clientY - touchState.lastY) * SENSITIVITY;
      sendMove(dx, dy);
    }
    touchState.lastX = t.clientX;
    touchState.lastY = t.clientY;
    if (Math.abs(t.clientX - touchState.startX) > TAP_MAX_MOVE || Math.abs(t.clientY - touchState.startY) > TAP_MAX_MOVE) {
      touchState.moved = true;
    }
  }, { passive: false });

  trackpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!touchState) return;
    const elapsed = Date.now() - touchState.startTime;
    const dx = touchState.lastX - touchState.startX;
    const dy = touchState.lastY - touchState.startY;
    const fingers = touchState.maxFingers;
    endTracking();

    if (fingers >= 3 && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      send(dx < 0 ? 'space/next' : 'space/prev');
    } else if (fingers === 1 && !touchState.moved && elapsed < TAP_MAX_MS) {
      if (!sendWs('click')) send('mouse/click');
    }
    touchState = null;
  }, { passive: false });

  trackpad.addEventListener('touchcancel', (e) => {
    endTracking();
    touchState = null;
  }, { passive: false });
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
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
      } else if (action === 'mouse/end') {
        mouseDragEnd();
      } else if (action === 'volume/up') {
        extra.volume = await changeVolume(VOLUME_STEP);
      } else if (action === 'volume/down') {
        extra.volume = await changeVolume(-VOLUME_STEP);
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
