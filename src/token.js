import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_BYTES = 16;
export const MIN_TOKEN_LENGTH = TOKEN_BYTES * 2;

/** Reads the saved token, generating one if missing or too short to be safe (older versions used 8 characters). */
export function getOrCreateToken(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= MIN_TOKEN_LENGTH) return existing;
  } catch { /* no saved token yet */ }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token);
  fs.chmodSync(file, 0o600); // the mode option is ignored when the file already exists
  return token;
}

export function tokensMatch(supplied, expected) {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
