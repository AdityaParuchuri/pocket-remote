import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PORT = Number(process.env.PORT) || 4321;
export const TOKEN_FILE = path.join(os.homedir(), '.pocket-remote', 'token');
export const PUBLIC_DIR = path.join(root, 'public');
export const DAEMON_SCRIPT = path.join(root, 'src', 'mac', 'input-daemon.jxa');

export const LIMITS = {
  mouseMove: 800,
  scroll: 2000,
  bodyBytes: 10_000,
  typeChars: 500,
  backspaces: 200,
  pullChars: 2000,
};
