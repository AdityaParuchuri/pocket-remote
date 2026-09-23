import { execFile, spawn } from 'node:child_process';

export function readClipboard() {
  return new Promise((resolve) => {
    execFile('pbpaste', { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

export function writeClipboard(text) {
  return new Promise((resolve) => {
    const child = spawn('pbcopy');
    child.on('close', resolve);
    child.on('error', resolve);
    child.stdin.end(text);
  });
}
