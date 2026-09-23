import { execFile } from 'node:child_process';
import os from 'node:os';

export function getLanUrls(port, token) {
  const urls = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const { family, internal, address } of addresses) {
      if (family === 'IPv4' && !internal) urls.push(`http://${address}:${port}/?token=${token}`);
    }
  }
  return urls;
}

/** The Mac's Bonjour name (without `.local`), which stays valid when its IP address changes. */
export function getLocalHostName() {
  return new Promise((resolve) => {
    execFile('scutil', ['--get', 'LocalHostName'], (err, stdout) => {
      resolve(err ? os.hostname().replace(/\.local$/, '') : stdout.trim());
    });
  });
}

function isPrivateIPv4(address) {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local
    (a === 100 && b >= 64 && b <= 127) // CGNAT, used by Tailscale
  );
}

/** Whether `address` is loopback, link-local or in a private range, i.e. not the public internet. */
export function isPrivateAddress(address = '') {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) return isPrivateIPv4(address);
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(lower);
}
