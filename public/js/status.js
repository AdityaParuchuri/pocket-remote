const statusEl = document.getElementById('status');

export function flash(message, durationMs, isError) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff6b6b' : '#9a9a9f';
  if (durationMs) {
    setTimeout(() => { if (statusEl.textContent === message) statusEl.textContent = ''; }, durationMs);
  }
}

export function clearStatus() {
  statusEl.textContent = '';
}
