import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPCODE, acceptKey, encodeFrame, parseFrame } from '../src/websocket.js';

function maskedFrame(opcode, payload, mask = Buffer.from([1, 2, 3, 4])) {
  const body = Buffer.from(payload);
  const masked = Buffer.from(body.map((byte, i) => byte ^ mask[i % 4]));
  const length = body.length;
  const header = length < 126
    ? Buffer.from([0x80 | opcode, 0x80 | length])
    : Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 0xff]);
  return Buffer.concat([header, mask, masked]);
}

test('computes the accept key from the RFC 6455 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('parses a masked text frame from a client', () => {
  const frame = parseFrame(maskedFrame(OPCODE.text, 'move 1 2'));
  assert.equal(frame.opcode, OPCODE.text);
  assert.equal(frame.payload.toString(), 'move 1 2');
});

test('parses 16-bit length frames', () => {
  const text = 'x'.repeat(300);
  const frame = parseFrame(maskedFrame(OPCODE.text, text));
  assert.equal(frame.payload.toString(), text);
});

test('reports frameLength so pipelined frames can be split', () => {
  const first = maskedFrame(OPCODE.text, 'click');
  const second = maskedFrame(OPCODE.text, 'end');
  const buffer = Buffer.concat([first, second]);
  const parsed = parseFrame(buffer);
  assert.equal(parsed.frameLength, first.length);
  assert.equal(parseFrame(buffer.subarray(parsed.frameLength)).payload.toString(), 'end');
});

test('returns null for incomplete frames', () => {
  const frame = maskedFrame(OPCODE.text, 'hello world');
  assert.equal(parseFrame(Buffer.alloc(0)), null);
  assert.equal(parseFrame(frame.subarray(0, 1)), null);
  assert.equal(parseFrame(frame.subarray(0, frame.length - 1)), null);
});

test('encoded server frames round-trip through the length tiers', () => {
  for (const size of [0, 5, 125, 126, 70000]) {
    const payload = Buffer.alloc(size, 'a');
    const encoded = encodeFrame(OPCODE.pong, payload);
    const frame = parseFrame(encoded);
    assert.equal(frame.opcode, OPCODE.pong);
    assert.equal(frame.payload.length, size);
    assert.equal(frame.frameLength, encoded.length);
  }
});
