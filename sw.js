/*
 * FA01 Kur Hesaplayici - service worker
 * Strategy: cache-first for same-origin app shell/static assets (fast
 * loads + full offline support), network-only passthrough for the
 * cross-origin rate APIs (never cache stale financial data, and avoid
 * Safari's known quirks around intercepting cross-origin fetches).
 */
const CACHE = "fa01-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./logo.jpeg",
  "./icons/icon-16.png",
  "./icons/icon-32.png",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-1024.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // allSettled: one missing/renamed asset must not fail the whole install
      Promise.allSettled(ASSETS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin) {
    // Rate/crypto APIs: always go to the network so numbers are never
    // stale/cached. Let app.js's own timeout + localStorage fallback
    // handle offline/error cases, exactly as before.
    return;
  }

  // Same-origin app shell: cache-first, falling back to network, and
  // repairing the cache in the background when a fresh copy is fetched.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            // waitUntil: without this, the browser can terminate the service
            // worker right after respondWith() settles, aborting this
            // background cache write before it finishes (cache never repaired).
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
