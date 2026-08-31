/* The Supreme Cheeto — service worker.
 *
 * Caching strategy is deliberately split, because this is a live-data site and
 * the classic mistake is caching the numbers:
 *
 *   app shell (html/js/css/icons) → stale-while-revalidate: instant load,
 *        updates picked up in the background on the next visit.
 *   /.netlify/functions/*         → NETWORK FIRST, always. A cached debt clock
 *        or a cached Truth feed would be worse than useless — it'd be wrong.
 *        Cache is only a last-resort fallback when genuinely offline, and the
 *        page's own freshness chips will mark it stale when that happens.
 *
 * Bump VERSION on any shell change to roll the cache over.
 */
const VERSION = "cheeto-v2.2.0";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

const PRECACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/logo.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // addAll is all-or-nothing; one 404 would abort the whole install,
      // so add individually and tolerate misses.
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never touch third-party requests

  /* ---- live data: network first, cache only as an offline fallback ---- */
  if (url.pathname.startsWith("/.netlify/functions/")) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) {
          const c = await caches.open(DATA);
          c.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        const hit = await caches.match(request);
        // No cached copy either: hand back a shape the page understands so it
        // falls back to its built-in snapshot instead of throwing.
        return hit || new Response(
          JSON.stringify({ empty: true, offline: true }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    })());
    return;
  }

  /* ---- navigations: network first so deploys land, cached shell if offline ---- */
  if (request.mode === "navigate") {
    e.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match("/index.html")) || (await caches.match("/")) ||
          new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
      }
    })());
    return;
  }

  /* ---- everything else: stale-while-revalidate ---- */
  e.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
        return res;
      })
      .catch(() => null);
    return cached || (await network) ||
      new Response("", { status: 504 });
  })());
});
