const statusEl = () => document.getElementById('status');

export function flash(message, durationMs, isError) {
  const el = statusEl();
  el.textContent = message;
  el.style.color = isError ? '#ff6b6b' : '#9a9a9f';
  if (durationMs) {
    setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, durationMs);
  }
}

export function clearStatus() {
  statusEl().textContent = '';
}
