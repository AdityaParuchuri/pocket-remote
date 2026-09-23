const statusEl = () => document.getElementById('status');
let hideTimer = null;

/** Shows a toast pill; `isError` adds a red indicator. Fades out after `durationMs` if given. */
export function flash(message, durationMs, isError) {
  const el = statusEl();
  clearTimeout(hideTimer);
  el.textContent = message;
  el.classList.toggle('error', Boolean(isError));
  el.classList.add('visible');
  if (durationMs) hideTimer = setTimeout(clearStatus, durationMs);
}

export function clearStatus() {
  clearTimeout(hideTimer);
  statusEl().classList.remove('visible');
}
