/** Builds the startup message: a QR code for the phone plus the plain URLs. */
export function formatBanner({ port, token, urls, hostName, qrCode }) {
  const lines = [`Pocket Remote running on port ${port}`, ''];

  if (urls.length === 0) {
    lines.push('No network connection found. Connect to WiFi and restart.', '');
  } else {
    lines.push("Scan with your phone's camera (same WiFi as this Mac):", '', qrCode(urls[0]), '');
    lines.push('Or open one of these on your phone:', '');
    for (const url of urls) lines.push(`  ${url}`);
    if (hostName) lines.push(`  http://${hostName}.local:${port}/?token=${token}`);
    lines.push('');
  }

  lines.push('Tip: on iPhone, tap Share, then Add to Home Screen, for one-tap access.');
  lines.push(`Token: ${token} (saved in ~/.pocket-remote/token, reused across restarts)`);
  lines.push('Keep this window open while you use the remote. Press Ctrl+C to stop.');
  return lines.join('\n');
}
