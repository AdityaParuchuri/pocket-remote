import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commands } from './input-commands.js';

const RESTART_DELAY_MS = 500;

/**
 * Keeps one resident osascript process alive and feeds it commands over a FIFO.
 * Spawning osascript per event costs ~100ms, which made cursor movement and
 * typing lag noticeably.
 */
export function createInputDaemon({ script }) {
  const fifoPath = path.join(os.tmpdir(), `pocket-remote-input-${process.pid}.fifo`);
  let child = null;
  let stream = null;
  let stopped = false;

  function start() {
    if (stopped) return;
    fs.rmSync(fifoPath, { force: true });
    execFile('mkfifo', [fifoPath], (err) => {
      if (err) {
        console.error('input daemon: failed to create fifo:', err.message);
        setTimeout(start, 1000);
        return;
      }
      if (stopped) return;

      const proc = spawn('osascript', ['-l', 'JavaScript', script, fifoPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      proc.stderr.on('data', (chunk) => console.error('input daemon:', chunk.toString().trim()));
      proc.on('exit', () => {
        if (child === proc) child = null;
        stream?.destroy();
        stream = null;
        setTimeout(start, RESTART_DELAY_MS);
      });
      child = proc;

      stream = fs.createWriteStream(fifoPath);
      stream.on('error', () => {}); // surfaced by the process exiting and restarting
    });
  }

  function send(line) {
    if (!stream) return Promise.reject(new Error('input control unavailable'));
    stream.write(`${line}\n`);
    return Promise.resolve();
  }

  function stop() {
    stopped = true;
    stream?.destroy();
    child?.kill();
    fs.rmSync(fifoPath, { force: true });
  }

  return {
    start,
    stop,
    move: (dx, dy) => send(commands.move(dx, dy)),
    click: () => send(commands.click()),
    scroll: (dy, dx) => send(commands.scroll(dy, dx)),
    endDrag: () => send(commands.endDrag()).catch(() => {}),
    type: (text) => send(commands.type(text)),
    backspace: (count) => send(commands.backspace(count)),
    enter: () => send(commands.enter()),
  };
}
