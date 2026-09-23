# Pocket Remote

**Control your MacBook from your phone.** Play and pause media, change volume and brightness, use your phone as a trackpad, switch windows, and type on your Mac with your phone's keyboard, from any browser on the same WiFi. Nothing to install on the phone, and no dependencies to install on the Mac.

## Quick start

Requires macOS and [Node.js](https://nodejs.org) 20 or newer.

```sh
npx pocket-remote
```

Or from source:

```sh
git clone https://github.com/AdityaParuchuri/pocket-remote.git
cd pocket-remote
npm start
```

It prints a URL like `http://192.168.1.20:4321/?token=…`. Open it on your phone while it's on the same WiFi network as your Mac. The token is saved in `~/.pocket-remote/token`, so the same URL keeps working across restarts. Add the page to your Home Screen for one-tap access.

### Grant Accessibility permission

Pocket Remote controls your Mac by sending it keystrokes and mouse events, so macOS needs to allow it. The first time you tap something, macOS may ask you to allow your terminal app. If controls do nothing, open **System Settings → Privacy & Security → Accessibility** and enable the terminal you started it from (Terminal, iTerm, VS Code, …).

## Controls

| Control | What it does |
| --- | --- |
| Play / rewind / forward | Sends Space, ← and → to the frontmost app (works for YouTube, QuickTime, Spotify web, …) |
| Vol, mute, Bright | Changes system volume in the same 16 steps as the keyboard, with an on-screen level indicator |
| Trackpad | One finger moves the cursor, tap to click, two fingers scroll, three fingers swipe to switch Spaces or open Mission Control / App Exposé |
| Scroll bar | Drag to scroll, or tap the top or bottom half to nudge |
| Scroll Windows bar | Swipe sideways, or tap the left or right half, to switch to the previous or next Space |
| Keyboard | Opens your phone's own keyboard, with autocorrect and swipe typing, and types into whatever is focused on the Mac |

### Typing and Sync

Click a text field on your Mac, then tap the keyboard button on your phone and start typing. To edit text that's already in the field, tap **Sync** in the keyboard panel to copy the field's contents to your phone first. (Sync briefly copies the field's text using Cmd+A / Cmd+C and restores your clipboard afterwards, so use it only when a text field is focused.)

## Security

Pocket Remote gives whoever holds the token **full keyboard and mouse control of your Mac**, which is enough to run commands in a terminal. Treat the URL like a password.

What it does to protect you:

- A random 128-bit token is required for every request, compared in constant time.
- Repeated wrong tokens lock out an address for 5 minutes.
- Only connections from your local network (private, link-local, loopback and Tailscale addresses) are accepted, so a port forwarded by mistake can't expose it to the internet.

What it can't do: traffic is plain HTTP, so anyone on the same network who can watch traffic can read the token. **Use it on networks you trust**, such as your home WiFi, and not on public WiFi. If the URL leaks, delete `~/.pocket-remote/token` and restart to generate a new one.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4321` | Port to listen on |

## How it works

A small Node server (no runtime dependencies) serves the phone UI and receives commands. It controls the Mac through `osascript` for media keys, volume and clipboard, and through one long-running JavaScript-for-Automation process for mouse and keyboard events, which keeps cursor movement and typing responsive. Trackpad movement streams over a WebSocket; everything else uses simple HTTP calls.

## Development

```sh
npm install
npm test               # unit and integration tests
npm run test:coverage  # with a coverage report
npm run lint
```

The code that talks to macOS lives in `src/mac/` behind a single interface, so the rest of the server and the tests run without touching your Mac.

## Limitations

- macOS only. It has been tested with iPhone and Safari; other phone browsers should work but aren't tested.
- The play/pause icon is a local guess, because macOS doesn't expose playback state.
- The brightness keys use legacy key codes that may not work on every Mac.

## License

[MIT](LICENSE)
