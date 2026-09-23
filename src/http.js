import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { LIMITS } from './config.js';
import { isPrivateAddress } from './network.js';
import { createAuthLimiter } from './rate-limit.js';
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

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, body, headers) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
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

async function handleApi(req, res, { authorize, actions }, name) {
  const auth = authorize(req, req.headers['x-remote-token']);
  if (auth === 'blocked') {
    return sendJson(res, 429, { error: 'too many failed attempts, try again later' }, { 'Retry-After': '300' });
  }
  if (auth === 'denied') return sendJson(res, 403, { error: 'invalid token' });
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
 * Returns 'ok', 'denied' or 'blocked' for a supplied token, counting failures
 * per client address so the token can't be guessed by brute force.
 */
function createAuthorizer({ token, limiter }) {
  return (req, supplied) => {
    const ip = req.socket.remoteAddress;
    if (limiter.isBlocked(ip)) return 'blocked';
    if (tokensMatch(supplied, token)) {
      limiter.recordSuccess(ip);
      return 'ok';
    }
    limiter.recordFailure(ip);
    return 'denied';
  };
}

/**
 * @param {object} options
 * @param {string} options.token shared secret required by the API and WebSocket
 * @param {Record<string, Function>} options.actions handlers keyed by API action name
 * @param {(message: string) => void} options.onSocketMessage receives trackpad WebSocket messages
 * @param {string} options.publicDir directory of static client files
 * @param {ReturnType<typeof createAuthLimiter>} [options.limiter] failed-auth tracker
 * @param {(address: string) => boolean} [options.allowClient] rejects clients outside private networks by default
 */
export function createHttpServer({
  token,
  actions,
  onSocketMessage,
  publicDir,
  limiter = createAuthLimiter(),
  allowClient = isPrivateAddress,
}) {
  const root = path.resolve(publicDir);
  const authorize = createAuthorizer({ token, limiter });

  const server = http.createServer((req, res) => {
    if (!allowClient(req.socket.remoteAddress)) {
      res.writeHead(403, SECURITY_HEADERS).end();
      return;
    }
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET') return serveStatic(res, root, pathname);
    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      return handleApi(req, res, { authorize, actions }, pathname.slice('/api/'.length));
    }
    res.writeHead(404).end();
  });

  server.on('upgrade', (req, socket) => {
    if (!allowClient(req.socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    const isAuthorized = (request, supplied) => authorize(request, supplied) === 'ok';
    handleUpgrade(req, socket, { authorize: isAuthorized, onMessage: onSocketMessage });
  });
  return server;
}
