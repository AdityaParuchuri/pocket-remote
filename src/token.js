import crypto from 'node:crypto';
import fs from 'node:fs';

export function getOrCreateToken(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const token = crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(file, token);
    return token;
  }
}

export function tokensMatch(supplied, expected) {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
