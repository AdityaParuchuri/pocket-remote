import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MIN_TOKEN_LENGTH, getOrCreateToken, tokensMatch } from '../src/token.js';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-remote-'));
  return path.join(dir, '.token');
}

test('creates a 128-bit token file on first use and reuses it afterwards', () => {
  const file = tempFile();
  const first = getOrCreateToken(file);
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(getOrCreateToken(file), first);
});

test('creates the containing directory when it does not exist', () => {
  const file = path.join(tempFile(), 'nested', 'token');
  const token = getOrCreateToken(file);
  assert.equal(fs.readFileSync(file, 'utf8'), token);
});

test('the token file is readable only by its owner', () => {
  const file = tempFile();
  getOrCreateToken(file);
  assert.equal(fs.statSync(file).mode & 0o077, 0);
});

test('trims whitespace from an existing token file', () => {
  const file = tempFile();
  const saved = 'a'.repeat(MIN_TOKEN_LENGTH);
  fs.writeFileSync(file, `${saved}\n`);
  assert.equal(getOrCreateToken(file), saved);
});

test('replaces a token that is too short to be safe', () => {
  const file = tempFile();
  fs.writeFileSync(file, '40a02a53');
  const token = getOrCreateToken(file);
  assert.notEqual(token, '40a02a53');
  assert.equal(token.length, MIN_TOKEN_LENGTH);
  assert.equal(fs.readFileSync(file, 'utf8'), token);
});

test('tokensMatch accepts only an identical string', () => {
  assert.equal(tokensMatch('secret', 'secret'), true);
  assert.equal(tokensMatch('secreT', 'secret'), false);
  assert.equal(tokensMatch('short', 'secret'), false);
  assert.equal(tokensMatch(undefined, 'secret'), false);
  assert.equal(tokensMatch(null, 'secret'), false);
});
