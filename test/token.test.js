import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getOrCreateToken, tokensMatch } from '../src/token.js';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-remote-'));
  return path.join(dir, '.token');
}

test('creates a token file on first use and reuses it afterwards', () => {
  const file = tempFile();
  const first = getOrCreateToken(file);
  assert.match(first, /^[0-9a-f]{8}$/);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(getOrCreateToken(file), first);
});

test('trims whitespace from an existing token file', () => {
  const file = tempFile();
  fs.writeFileSync(file, 'abc123\n');
  assert.equal(getOrCreateToken(file), 'abc123');
});

test('tokensMatch accepts only an identical string', () => {
  assert.equal(tokensMatch('secret', 'secret'), true);
  assert.equal(tokensMatch('secreT', 'secret'), false);
  assert.equal(tokensMatch('short', 'secret'), false);
  assert.equal(tokensMatch(undefined, 'secret'), false);
  assert.equal(tokensMatch(null, 'secret'), false);
});
