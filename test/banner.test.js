import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBanner } from '../src/banner.js';

const base = {
  port: 4321,
  token: 'abc',
  urls: ['http://192.168.1.5:4321/?token=abc', 'http://10.0.0.5:4321/?token=abc'],
  hostName: 'My-Mac',
  qrCode: (url) => `[QR:${url}]`,
};

test('encodes the first LAN URL in the QR code', () => {
  const banner = formatBanner(base);
  assert.ok(banner.includes('[QR:http://192.168.1.5:4321/?token=abc]'));
  assert.ok(!banner.includes('[QR:http://10.0.0.5'));
});

test('lists every LAN URL plus the stable Bonjour address', () => {
  const banner = formatBanner(base);
  assert.ok(banner.includes('  http://192.168.1.5:4321/?token=abc'));
  assert.ok(banner.includes('  http://10.0.0.5:4321/?token=abc'));
  assert.ok(banner.includes('  http://My-Mac.local:4321/?token=abc'));
});

test('omits the Bonjour address when the host name is unknown', () => {
  assert.ok(!formatBanner({ ...base, hostName: '' }).includes('.local'));
});

test('explains when there is no network instead of printing a QR code', () => {
  const banner = formatBanner({ ...base, urls: [] });
  assert.ok(banner.includes('No network connection found'));
  assert.ok(!banner.includes('[QR:'));
});

test('tells the user to keep the window open', () => {
  assert.ok(formatBanner(base).includes('Keep this window open'));
});
