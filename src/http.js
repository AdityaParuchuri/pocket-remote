import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { LIMITS } from './config.js';
import { tokensMatch } from './token.js';
import { HttpError } from './util.js';
import { handleUpgrade } from './websocket.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const ACCESSIBILITY_ERROR = /not allowed to send keystrokes|assistive access|not allowed assistive/i;
const ACCESSIBILITY_HINT =
  'Grant Accessibility permission to Terminal in System Settings → Privacy & Security → Accessibility';

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > LIMITS.bodyBytes) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, 'invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, publicDir, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(publicDir, relative);
  const mimeType = MIME_TYPES[path.extname(file)];
  if (!mimeType || !file.startsWith(publicDir + path.sep)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
}

async function handleApi(req, res, { token, actions }, name) {
  if (!tokensMatch(req.headers['x-remote-token'], token)) {
    return sendJson(res, 403, { error: 'invalid token' });
  }
  const action = Object.hasOwn(actions, name) ? actions[name] : null;
  if (!action) return sendJson(res, 404, { error: 'unknown action' });

  try {
    const body = await readJsonBody(req);
    const extra = await action(body);
    sendJson(res, 200, { ok: true, ...extra });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = ACCESSIBILITY_ERROR.test(err.message) ? ACCESSIBILITY_HINT : err.message;
    sendJson(res, status, { error: message });
  }
}

/**
 * @param {object} options
 * @param {string} options.token shared secret required by the API and WebSocket
 * @param {Record<string, Function>} options.actions handlers keyed by API action name
 * @param {(message: string) => void} options.onSocketMessage receives trackpad WebSocket messages
 * @param {string} options.publicDir directory of static client files
 */
export function createHttpServer({ token, actions, onSocketMessage, publicDir }) {
  const root = path.resolve(publicDir);
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET') return serveStatic(res, root, pathname);
    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      return handleApi(req, res, { token, actions }, pathname.slice('/api/'.length));
    }
    res.writeHead(404).end();
  });
  server.on('upgrade', (req, socket) => {
    handleUpgrade(req, socket, { token, onMessage: onSocketMessage });
  });
  return server;
}
