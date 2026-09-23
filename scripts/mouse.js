// JXA helper for cursor move/click, invoked as:
//   osascript -l JavaScript mouse.js move <dx> <dy>
//   osascript -l JavaScript mouse.js click
ObjC.import('CoreGraphics');

function currentLocation() {
  return $.CGEventGetLocation($.CGEventCreate($()));
}

function post(type, point, button) {
  const event = $.CGEventCreateMouseEvent($(), type, point, button === undefined ? 0 : button);
  $.CGEventPost($.kCGHIDEventTap, event);
}

function run(argv) {
  const cmd = argv[0];
  if (cmd === 'move') {
    const dx = parseFloat(argv[1]);
    const dy = parseFloat(argv[2]);
    const cur = currentLocation();
    post($.kCGEventMouseMoved, $.CGPointMake(cur.x + dx, cur.y + dy));
  } else if (cmd === 'click') {
    const cur = currentLocation();
    post($.kCGEventLeftMouseDown, cur, 0);
    post($.kCGEventLeftMouseUp, cur, 0);
  }
}
