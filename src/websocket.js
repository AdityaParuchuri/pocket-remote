import crypto from 'node:crypto';
import { tokensMatch } from './token.js';

// Minimal RFC 6455 server, dependency-free. The trackpad streams many small
// messages, and one persistent socket avoids per-move HTTP overhead.
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODE = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa };

export function acceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_GUID).digest('base64');
}

/** Parses one frame from the start of `buf`, or returns null if it is incomplete. */
export function parseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buf.length < 4) return null;
    length = buf.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    length = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + length) return null;

  let payload = buf.subarray(offset, offset + length);
  if (mask) payload = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  return { opcode, payload, frameLength: offset + length };
}

export function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header.writeUInt16BE(length, 2);
    header[1] = 126;
  } else {
    header = Buffer.alloc(10);
    header.writeBigUInt64BE(BigInt(length), 2);
    header[1] = 127;
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

/** Upgrades `/ws?token=...` requests and passes each text message to `onMessage`. */
export function handleUpgrade(req, socket, { token, onMessage }) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key || !tokensMatch(url.searchParams.get('token'), token)) {
    socket.destroy();
    return;
  }

  // Nagle's algorithm would otherwise batch small frames and cause stutter.
  socket.setNoDelay(true);
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '\r\n',
  ].join('\r\n'));

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let frame = parseFrame(buffer); frame; frame = parseFrame(buffer)) {
      buffer = buffer.subarray(frame.frameLength);
      if (frame.opcode === OPCODE.close) {
        socket.end(encodeFrame(OPCODE.close, Buffer.alloc(0)));
        return;
      }
      if (frame.opcode === OPCODE.ping) socket.write(encodeFrame(OPCODE.pong, frame.payload));
      else if (frame.opcode === OPCODE.text) onMessage(frame.payload.toString('utf8'));
    }
  });
  socket.on('error', () => {});
}
