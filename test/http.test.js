import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createHttpServer } from '../src/http.js';
import { HttpError } from '../src/util.js';
import { acceptKey } from '../src/websocket.js';

const TOKEN = 'test-token';
const messages = [];
let server;
let baseUrl;
let port;
let publicDir;

before(async () => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-remote-public-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'export {};');
  fs.writeFileSync(path.join(publicDir, 'notes.txt'), 'secret');
  fs.writeFileSync(path.join(path.dirname(publicDir), 'outside.html'), 'outside');

  server = createHttpServer({
    token: TOKEN,
    publicDir,
    onSocketMessage: (text) => messages.push(text),
    actions: {
      ok: async () => {},
      echo: async (body) => ({ echoed: body.value }),
      teapot: async () => { throw new HttpError(418, 'short and stout'); },
      broken: async () => { throw new Error('boom'); },
      denied: async () => { throw new Error('osascript is not allowed to send keystrokes'); },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ({ port } = server.address());
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
}));

const post = (action, { token = TOKEN, body } = {}) => fetch(`${baseUrl}/api/${action}`, {
  method: 'POST',
  headers: { 'x-remote-token': token, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});

test('serves index.html at / without caching', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), '<h1>home</h1>');
});

test('serves other static files with the right content type', async () => {
  const res = await fetch(`${baseUrl}/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
});

test('does not serve missing files, unknown types, or paths outside the public dir', async () => {
  assert.equal((await fetch(`${baseUrl}/missing.js`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/notes.txt`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/../outside.html`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/%2e%2e/outside.html`)).status, 404);
});

test('rejects API calls with a missing or wrong token', async () => {
  assert.equal((await post('ok', { token: 'wrong' })).status, 403);
  const noHeader = await fetch(`${baseUrl}/api/ok`, { method: 'POST' });
  assert.equal(noHeader.status, 403);
  assert.deepEqual(await noHeader.json(), { error: 'invalid token' });
});

test('returns 404 for unknown actions, including inherited object keys', async () => {
  assert.equal((await post('nope')).status, 404);
  assert.equal((await post('constructor')).status, 404);
  assert.equal((await post('__proto__')).status, 404);
});

test('runs an action and merges its result into { ok: true }', async () => {
  const res = await post('ok');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const echo = await post('echo', { body: { value: 42 } });
  assert.deepEqual(await echo.json(), { ok: true, echoed: 42 });
});

test('rejects malformed JSON with a 400', async () => {
  const res = await post('echo', { body: '{not json' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid json body' });
});

test('maps HttpError status and generic errors to 500', async () => {
  const teapot = await post('teapot');
  assert.equal(teapot.status, 418);
  assert.deepEqual(await teapot.json(), { error: 'short and stout' });

  const broken = await post('broken');
  assert.equal(broken.status, 500);
  assert.deepEqual(await broken.json(), { error: 'boom' });
});

test('replaces accessibility errors with an actionable hint', async () => {
  const res = await post('denied');
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /Accessibility permission/);
});

test('ignores unsupported methods and paths', async () => {
  assert.equal((await fetch(`${baseUrl}/api/ok`, { method: 'PUT' })).status, 404);
  assert.equal((await fetch(`${baseUrl}/nope`, { method: 'DELETE' })).status, 404);
});

function upgrade(query) {
  const key = 'dGhlIHNhbXBsZSBub25jZQ==';
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write([
        `GET /ws${query} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n',
      ].join('\r\n'));
    });
    let response = '';
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (response.includes('\r\n\r\n')) resolve({ socket, response, key });
    });
    socket.on('close', () => resolve({ socket, response, key }));
    socket.on('error', () => {});
  });
}

test('upgrades a WebSocket with a valid token and delivers text messages', async () => {
  const { socket, response, key } = await upgrade(`?token=${TOKEN}`);
  assert.match(response, /^HTTP\/1\.1 101/);
  assert.ok(response.includes(`Sec-WebSocket-Accept: ${acceptKey(key)}`));

  const payload = Buffer.from('move 1 2');
  const mask = Buffer.from([9, 8, 7, 6]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(messages, ['move 1 2']);
  socket.destroy();
});

test('refuses a WebSocket with a bad token', async () => {
  const { response } = await upgrade('?token=wrong');
  assert.equal(response, '');
});
