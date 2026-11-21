// Offline-Speicher der Vorhangberechnung
const CACHE = 'vorhangberechnung-v59';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png', './etikett.html', './pdfdruck.js'];
self.addEventListener('install', e => {
  // cache:'reload' – immer frisch vom Server holen, nicht aus dem Browser-Zwischenspeicher (sonst bleibt nach einem Update die alte Fassung)
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Erst aus dem Speicher laden (schnell, offline), im Hintergrund nach neuer Version schauen
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // Abgleich (Supabase) nie aus dem Speicher

  e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => {
    const net = fetch(req.mode === 'navigate' ? req.url : req, {cache: 'no-cache'}).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
