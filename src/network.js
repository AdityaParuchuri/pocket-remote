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
