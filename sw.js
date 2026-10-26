// MovieLingo service worker: makes the site installable and usable offline.
// The page (7 MB, includes the dictionary) is served from cache straight away and refreshed in the background;
// when a newer page arrives the open tabs are told, so they can offer a reload.
// Bump VERSION only when this file's caching logic changes; page updates do not need it.
const VERSION = "v2";
const SHELL = `movielingo-shell-${VERSION}`;
const IMG = `movielingo-img-${VERSION}`;
const PAGE = "./";
const ASSETS = ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/icon.svg"];
const CDN = ["https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"];
const FONTS = /^https:\/\/(fonts\.(googleapis|gstatic)\.com\/|cdn\.jsdelivr\.net\/npm\/lxgw-wenkai)/;
const POSTERS = /^https:\/\/image\.tmdb\.org\//;
const MAX_POSTERS = 300;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll([PAGE, ...ASSETS]);
    await c.addAll(CDN).catch(() => {}); // the CDN being down must not block installing
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("movielingo-") && k !== SHELL && k !== IMG) await caches.delete(k);
    await self.clients.claim();
  })());
});

const stamp = (r) => r && (r.headers.get("etag") || r.headers.get("last-modified") || r.headers.get("content-length"));

async function page(e) {
  const c = await caches.open(SHELL);
  const cached = await c.match(PAGE);
  const fresh = fetch(PAGE, { cache: "no-cache" }).then(async (res) => {
    if (!res.ok) return res;
    await c.put(PAGE, res.clone());
    if (cached && stamp(cached) !== stamp(res)) {
      for (const w of await self.clients.matchAll({ type: "window" })) w.postMessage({ type: "updated" });
    }
    return res;
  });
  if (cached) {
    e.waitUntil(fresh.catch(() => {}));
    return cached;
  }
  return fresh;
}

async function cacheFirst(req, name, limit) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    await c.put(req, res.clone());
    if (limit) {
      const keys = await c.keys();
      for (const k of keys.slice(0, Math.max(keys.length - limit, 0))) await c.delete(k);
    }
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (req.mode === "navigate" && url.origin === scope.origin && /\/(index\.html)?$/.test(url.pathname)) {
    e.respondWith(page(e));
  } else if (url.origin === scope.origin || CDN.includes(req.url) || FONTS.test(req.url)) {
    e.respondWith(cacheFirst(req, SHELL));
  } else if (POSTERS.test(req.url)) {
    e.respondWith(cacheFirst(req, IMG, MAX_POSTERS));
  } // everything else (the API Worker) goes straight to the network
});
