import { clearStatus, flash } from './status.js';
import { getStored, setStored, vibrate } from './util.js';

const TOKEN_KEY = 'remoteToken';
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

const appEl = document.getElementById('app');
const tokenBox = document.getElementById('tokenBox');
const tokenInput = document.getElementById('tokenInput');

const urlToken = new URLSearchParams(location.search).get('token');
let token = urlToken || getStored(TOKEN_KEY) || '';
if (urlToken) setStored(TOKEN_KEY, token);

let socket = null;
let reconnectDelay = RECONNECT_MIN_MS;

function showTokenPrompt() {
  appEl.style.display = 'none';
  tokenBox.style.display = 'flex';
}

function connectSocket() {
  if (!token) return;
  socket = new WebSocket(`ws://${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket.onopen = () => { reconnectDelay = RECONNECT_MIN_MS; };
  socket.onclose = () => {
    socket = null;
    setTimeout(connectSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  };
  socket.onerror = () => socket.close();
}

/** Sends over the WebSocket if it is open; returns whether it was sent. */
export function sendSocket(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(message);
  return true;
}

/** Calls `POST /api/<action>`; resolves to the response body, or null on failure. */
export async function send(action, body) {
  if (!token) {
    showTokenPrompt();
    return null;
  }
  try {
    const headers = { 'x-remote-token': token };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api/${action}`, {
      method: 'POST',
      headers,
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
  } catch {
    flash('Cannot reach laptop', 3000, true);
    return null;
  }
}

export function initSession() {
  document.getElementById('tokenSave').onclick = () => {
    token = tokenInput.value.trim();
    if (!token) return;
    setStored(TOKEN_KEY, token);
    tokenBox.style.display = 'none';
    appEl.style.display = 'flex';
    clearStatus();
    connectSocket();
  };

  if (token) connectSocket();
  else showTokenPrompt();
}
