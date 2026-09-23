// JXA helper for cursor/scroll control. Two modes:
//   osascript -l JavaScript mouse.js move <dx> <dy>       (one-shot)
//   osascript -l JavaScript mouse.js click                 (one-shot)
//   osascript -l JavaScript mouse.js daemon <fifoPath>     (stays resident,
//     reads newline-delimited commands — move/click/scroll/end — from a
//     named pipe, avoiding the per-call process-spawn cost of the one-shot
//     form, which is what made continuous trackpad drags feel laggy. A real
//     FIFO is used instead of stdin because Node puts its child-process
//     stdio pipes in non-blocking mode, which makes NSFileHandle.availableData
//     spin instead of block; a FIFO opened by path is unaffected.)
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

function currentLocation() {
  return $.CGEventGetLocation($.CGEventCreate($()));
}

function post(type, point, button) {
  const event = $.CGEventCreateMouseEvent($(), type, point, button === undefined ? 0 : button);
  $.CGEventPost($.kCGHIDEventTap, event);
}

function doMove(dx, dy) {
  const cur = currentLocation();
  post($.kCGEventMouseMoved, $.CGPointMake(cur.x + dx, cur.y + dy));
}

function doClick() {
  const cur = currentLocation();
  post($.kCGEventLeftMouseDown, cur, 0);
  post($.kCGEventLeftMouseUp, cur, 0);
}

// In daemon mode we track the cursor position ourselves rather than asking
// macOS for it on every move. CGEventPost is fire-and-forget: WindowServer
// may not have applied the previous synthetic move yet, so re-querying
// "current" position mid-drag can return a stale value, causing deltas to
// be skipped or double-applied — a patchy, stepwise-feeling cursor instead
// of a smooth trail.
let trackedX = null;
let trackedY = null;

function daemonMove(dx, dy) {
  if (trackedX === null) {
    const cur = currentLocation();
    trackedX = cur.x;
    trackedY = cur.y;
  }
  trackedX += dx;
  trackedY += dy;
  post($.kCGEventMouseMoved, $.CGPointMake(trackedX, trackedY));
}

function daemonClick() {
  const point = trackedX === null ? currentLocation() : $.CGPointMake(trackedX, trackedY);
  post($.kCGEventLeftMouseDown, point, 0);
  post($.kCGEventLeftMouseUp, point, 0);
}

// wheel1 is vertical delta, wheel2 is horizontal delta. Empirically (tested
// live) macOS scrolls content in the opposite direction from what CG's docs
// implied, so both axes are negated here — this is the one place that
// needs to change if the direction ever needs flipping again.
function doScroll(dy, dx) {
  const event = $.CGEventCreateScrollWheelEvent($(), $.kCGScrollEventUnitPixel, 2, -dy, -dx);
  $.CGEventPost($.kCGHIDEventTap, event);
}

function handleLine(line) {
  const parts = line.split(' ');
  if (parts[0] === 'move') {
    daemonMove(parseFloat(parts[1]), parseFloat(parts[2]));
  } else if (parts[0] === 'click') {
    daemonClick();
  } else if (parts[0] === 'scroll') {
    doScroll(parseFloat(parts[1]), parseFloat(parts[2]));
  } else if (parts[0] === 'end') {
    // Drag session over: forget the tracked position so the next drag
    // re-syncs with wherever the real cursor is (e.g. the physical
    // trackpad may have moved it in the meantime).
    trackedX = null;
    trackedY = null;
  }
}

function runDaemon(fifoPath) {
  const fh = $.NSFileHandle.fileHandleForReadingAtPath(fifoPath);
  let buffer = '';
  while (true) {
    const data = fh.availableData; // blocks until data or writer closes
    if (!data || data.length === 0) break; // EOF: writer closed the fifo
    const chunk = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          handleLine(line);
        } catch (e) {
          // Never let one bad command kill the daemon — every trackpad
          // action for the rest of the session routes through this one
          // process, so a crash here is much worse than a dropped event.
        }
      }
    }
  }
}

function run(argv) {
  if (argv[0] === 'daemon') {
    runDaemon(argv[1]);
    return;
  }
  if (argv[0] === 'move') {
    doMove(parseFloat(argv[1]), parseFloat(argv[2]));
  } else if (argv[0] === 'click') {
    doClick();
  }
}
