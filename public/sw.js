const CACHE_PREFIX = "chagokchan-public-static-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const PRECACHE_URLS = ["/offline.html", "/pwa-icons/180", "/pwa-icons/192", "/pwa-icons/512"];
const ALLOWED_DESTINATIONS = new Set(["script", "style", "image", "font"]);
const MAX_CACHE_ENTRIES = 100;

function isVersionedStaticRequest(request) {
  if (request.method !== "GET" || !ALLOWED_DESTINATIONS.has(request.destination)) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || url.hash) return false;
  return url.pathname.startsWith("/_next/static/") || ["/pwa-icons/180", "/pwa-icons/192", "/pwa-icons/512"].includes(url.pathname);
}

function isCacheableStaticResponse(response, request) {
  if (!response.ok || response.type !== "basic") return false;
  const url = new URL(request.url);
  const contentType = response.headers.get("content-type") || "";
  const cacheControl = response.headers.get("cache-control") || "";
  if (url.pathname.startsWith("/_next/static/")) {
    return /\bimmutable\b/i.test(cacheControl) && !/text\/html/i.test(contentType);
  }
  return url.pathname.startsWith("/pwa-icons/") && /image\/png/i.test(contentType) && /\bpublic\b/i.test(cacheControl);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_CACHE_ENTRIES))) {
    await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (isVersionedStaticRequest(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (isCacheableStaticResponse(response, request)) {
        await cache.put(request, response.clone());
        await trimCache(cache);
      }
      return response;
    })());
    return;
  }

  const url = new URL(request.url);
  if (request.method === "GET" && request.mode === "navigate" && url.origin === self.location.origin && url.pathname === "/" && !url.search) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match("/offline.html") || new Response("연결할 수 없어요. 인터넷에 연결한 뒤 다시 시도해 주세요.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }));
  }
});
