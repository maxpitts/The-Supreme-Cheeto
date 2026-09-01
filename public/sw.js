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
const VERSION = "cheeto-v3.9.0";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

const PRECACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/chat.js",
  "/community.js",
  "/ads.js",
  "/charts.js",
  "/predict.js",
  "/live.js",
  "/react.js",
  "/friends.js",
  "/navigator.js",
  "/stream.js",
  "/tally.js",
  "/poke.js",
  "/digest.js",
  "/supabase.js",
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
      // Deliberately NOT skipWaiting() here. Activating immediately swaps the
      // asset cache under a page that has already executed the OLD scripts, so
      // the tab keeps running stale code while the cache says it's current —
      // which is exactly how a corrected ad URL kept pointing at the old site.
      // The new worker waits until the page tells it to take over, and the page
      // then reloads, so code and cache always change together.
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

  /* ---- our own scripts: network first ----
     Stale-while-revalidate on JS means a deploy is always one visit late: the
     page runs yesterday's code and only fetches today's in the background.
     For a handful of small files that is not worth the millisecond it saves. */
  if (url.pathname.endsWith(".js")) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) { const c = await caches.open(SHELL); c.put(request, fresh.clone()); }
        return fresh;
      } catch {
        return (await caches.match(request)) || new Response("", { status: 504 });
      }
    })());
    return;
  }

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
