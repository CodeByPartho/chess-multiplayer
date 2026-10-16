// Service-worker registration lives in its own file (not an inline snippet)
// so the deployed Content-Security-Policy can keep script-src free of
// 'unsafe-inline'.
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && !location.hostname.startsWith('127.')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
