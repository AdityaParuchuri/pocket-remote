import { execFile } from 'node:child_process';

export function runOsascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}
