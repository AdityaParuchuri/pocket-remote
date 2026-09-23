#!/usr/bin/env node
import { renderUnicodeCompact } from 'uqr';
import { createActions } from './actions.js';
import { formatBanner } from './banner.js';
import { DAEMON_SCRIPT, PORT, PUBLIC_DIR, TOKEN_FILE } from './config.js';
import { createHttpServer } from './http.js';
import { createMac } from './mac/index.js';
import { getLanUrls, getLocalHostName } from './network.js';
import { getOrCreateToken } from './token.js';
import { handleTrackpadMessage } from './trackpad-messages.js';

const token = getOrCreateToken(TOKEN_FILE);
const mac = createMac({ daemonScript: DAEMON_SCRIPT });

const server = createHttpServer({
  token,
  actions: createActions(mac),
  onSocketMessage: (text) => handleTrackpadMessage(text, mac.input),
  publicDir: PUBLIC_DIR,
});

function shutdown() {
  mac.input.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => mac.input.stop());

mac.input.start();
server.listen(PORT, '0.0.0.0', async () => {
  console.log(formatBanner({
    port: PORT,
    token,
    urls: getLanUrls(PORT, token),
    hostName: await getLocalHostName(),
    qrCode: renderUnicodeCompact,
  }));
});
