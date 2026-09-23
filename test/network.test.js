import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrivateAddress } from '../src/network.js';

test('accepts loopback and private IPv4 ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.66', '169.254.1.1', '100.64.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('rejects public IPv4 addresses and near-miss ranges', () => {
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '100.128.0.1', '1.2.3.4']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('unwraps IPv4-mapped IPv6 addresses', () => {
  assert.equal(isPrivateAddress('::ffff:192.168.1.5'), true);
  assert.equal(isPrivateAddress('::ffff:8.8.8.8'), false);
});

test('accepts loopback, link-local and unique-local IPv6', () => {
  for (const ip of ['::1', 'fe80::1', 'fd12:3456::1', 'fc00::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('rejects public IPv6 and missing addresses', () => {
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
  assert.equal(isPrivateAddress(undefined), false);
  assert.equal(isPrivateAddress(''), false);
});
