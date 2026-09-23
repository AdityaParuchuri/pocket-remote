import { createActions } from './actions.js';
import { DAEMON_SCRIPT, PORT, PUBLIC_DIR, TOKEN_FILE } from './config.js';
import { createHttpServer } from './http.js';
import { createMac } from './mac/index.js';
import { getLanUrls } from './network.js';
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pocket Remote running on port ${PORT}\n`);
  console.log('Open one of these on your phone (same WiFi):\n');
  for (const url of getLanUrls(PORT, token)) console.log(`  ${url}`);
  console.log(`\nToken: ${token} (saved in .token, reused across restarts)`);
});
