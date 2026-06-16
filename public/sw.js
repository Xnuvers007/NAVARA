/* ═══════════════════════════════════════════════════════════
   BEGAL ALERT — Service Worker v1.1
   Strategi: Cache-first untuk aset statis, Network-first untuk API
   ═══════════════════════════════════════════════════════════ */

const CACHE_NAME = 'begal-alert-v1.1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/assets/icons/icon-512.png'
];

// ─── Install: Cache static assets ────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: Hapus cache lama ──────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: Cache strategy ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip SSE / API calls — selalu ke network
  if (url.pathname.startsWith('/api/') || url.pathname === '/api/reports/stream') {
    return; // bypass SW, biarkan browser handle langsung
  }

  // Skip external resources (Leaflet CDN, OpenStreetMap tiles)
  if (!url.origin.includes(self.location.origin) ||
      url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    return;
  }

  // Static assets: Cache-first, fallback ke network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((res) => {
          // Cache response yang berhasil
          if (res && res.status === 200 && res.type === 'basic') {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, resClone));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback untuk navigasi
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
    })
  );
});

// ─── Background Sync (offline report queuing) ────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(syncPendingReports());
  }
});

async function syncPendingReports() {
  // Mengambil laporan pending dari IndexedDB (jika ada)
  // Implementasi IDB di app.js
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'sync-complete' }));
}
