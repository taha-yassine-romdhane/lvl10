// Level 10 service worker: makes the app installable, caches the immutable
// build assets, keeps a fallback copy of recently opened pages for flaky
// networks, and shows an offline page when there's nothing else. Game
// traffic (socket.io) is never touched — it has to be live.
const CACHE = "lvl10-v2";
const PAGES = "lvl10-pages-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];
const MAX_PAGES = 12;
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== PAGES)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function rememberPage(req, res) {
  const cache = await caches.open(PAGES);
  await cache.put(req, res);
  const keys = await cache.keys();
  // keep only the most recent pages
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) {
    await cache.delete(old);
  }
}

/**
 * Pages: network first (rooms are live and deploys change asset hashes), but
 * don't hang on a bad connection — after a few seconds fall back to the last
 * copy of this page, then to the offline page.
 */
function navigate(event) {
  const req = event.request;
  const network = fetch(req);
  // Registered up front: waitUntil can't be called once the response is out.
  // This callback also runs first, so it clones before the page reads the body.
  event.waitUntil(
    network
      .then((res) => (res.ok ? rememberPage(req, res.clone()) : undefined))
      .catch(() => undefined)
  );
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, NETWORK_TIMEOUT_MS)
  ).then(() => caches.match(req, { cacheName: PAGES }));
  return Promise.race([network, timeout])
    .then((res) => res || network)
    .catch(() => caches.match(req, { cacheName: PAGES }))
    .then((res) => res || caches.match(OFFLINE_URL));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io")) return;

  if (req.mode === "navigate") {
    event.respondWith(navigate(event));
    return;
  }

  // Hashed build assets and icons never change: cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE.includes(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              event.waitUntil(
                caches.open(CACHE).then((cache) => cache.put(req, copy))
              );
            }
            return res;
          })
      )
    );
  }
});
