export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Clamps a pair of deltas to ±limit; returns null unless both are finite numbers. */
export function clampDelta(a, b, limit) {
  const x = clamp(Number(a), -limit, limit);
  const y = clamp(Number(b), -limit, limit);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
