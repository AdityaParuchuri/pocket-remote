import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthLimiter } from '../src/rate-limit.js';

function limiterWithClock(options) {
  const clock = { time: 0 };
  const limiter = createAuthLimiter({ now: () => clock.time, ...options });
  return { limiter, clock };
}

const fail = (limiter, ip, times) => {
  for (let i = 0; i < times; i++) limiter.recordFailure(ip);
};

test('blocks an address after too many failures within the window', () => {
  const { limiter } = limiterWithClock({ maxFailures: 3 });
  fail(limiter, '10.0.0.1', 2);
  assert.equal(limiter.isBlocked('10.0.0.1'), false);
  fail(limiter, '10.0.0.1', 1);
  assert.equal(limiter.isBlocked('10.0.0.1'), true);
});

test('only blocks the offending address', () => {
  const { limiter } = limiterWithClock({ maxFailures: 2 });
  fail(limiter, '10.0.0.1', 2);
  assert.equal(limiter.isBlocked('10.0.0.2'), false);
});

test('the lockout expires', () => {
  const { limiter, clock } = limiterWithClock({ maxFailures: 2, lockoutMs: 1000 });
  fail(limiter, 'a', 2);
  clock.time = 999;
  assert.equal(limiter.isBlocked('a'), true);
  clock.time = 1000;
  assert.equal(limiter.isBlocked('a'), false);
});

test('failures spread beyond the window do not accumulate', () => {
  const { limiter, clock } = limiterWithClock({ maxFailures: 3, windowMs: 1000 });
  fail(limiter, 'a', 2);
  clock.time = 1500;
  fail(limiter, 'a', 2);
  assert.equal(limiter.isBlocked('a'), false);
});

test('a successful login clears the failure count', () => {
  const { limiter } = limiterWithClock({ maxFailures: 3 });
  fail(limiter, 'a', 2);
  limiter.recordSuccess('a');
  fail(limiter, 'a', 2);
  assert.equal(limiter.isBlocked('a'), false);
});

test('unknown addresses are not blocked', () => {
  assert.equal(createAuthLimiter().isBlocked('nobody'), false);
});
