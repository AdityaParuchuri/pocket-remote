// JXA helper for cursor move/click. Two modes:
//   osascript -l JavaScript mouse.js move <dx> <dy>       (one-shot)
//   osascript -l JavaScript mouse.js click                 (one-shot)
//   osascript -l JavaScript mouse.js daemon <fifoPath>     (stays resident,
//     reads newline-delimited "move <dx> <dy>" / "click" commands from a
//     named pipe — avoids the per-call process-spawn cost of the one-shot
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

function handleLine(line) {
  const parts = line.split(' ');
  if (parts[0] === 'move') {
    doMove(parseFloat(parts[1]), parseFloat(parts[2]));
  } else if (parts[0] === 'click') {
    doClick();
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
      if (line) handleLine(line);
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
