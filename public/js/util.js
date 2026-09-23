export function vibrate() {
  if (navigator.vibrate) navigator.vibrate(15);
}

// `el.hidden` does not reliably reflect to the attribute on SVG elements, so
// CSS such as :not([hidden]) would miss the change.
export function setHidden(el, hide) {
  if (hide) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

// Storage access can throw (Private Browsing, blocked cookies), and an
// uncaught throw here would stop every handler from being wired up.
export function getStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function setStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
