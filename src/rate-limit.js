const DEFAULTS = { maxFailures: 10, windowMs: 60_000, lockoutMs: 300_000 };
const SWEEP_THRESHOLD = 500;

/**
 * Tracks failed authentication per client address. After `maxFailures` within
 * `windowMs` the address is locked out for `lockoutMs`, which makes guessing
 * the token over the network impractical.
 */
export function createAuthLimiter({ now = Date.now, ...options } = {}) {
  const { maxFailures, windowMs, lockoutMs } = { ...DEFAULTS, ...options };
  const clients = new Map();

  function sweep() {
    const t = now();
    for (const [ip, entry] of clients) {
      if (entry.blockedUntil <= t && t - entry.windowStart > windowMs) clients.delete(ip);
    }
  }

  return {
    isBlocked(ip) {
      return (clients.get(ip)?.blockedUntil ?? 0) > now();
    },

    recordFailure(ip) {
      const t = now();
      if (clients.size > SWEEP_THRESHOLD) sweep();
      let entry = clients.get(ip);
      if (!entry || t - entry.windowStart > windowMs) {
        entry = { failures: 0, windowStart: t, blockedUntil: entry?.blockedUntil ?? 0 };
        clients.set(ip, entry);
      }
      entry.failures++;
      if (entry.failures >= maxFailures) {
        entry.blockedUntil = t + lockoutMs;
        entry.failures = 0;
      }
    },

    recordSuccess(ip) {
      clients.delete(ip);
    },
  };
}
