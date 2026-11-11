/*
 * Killing It service worker source.
 *
 * Vite does not serve this file directly. `buildServiceWorker.ts` walks the
 * finished build, replaces the two placeholders below with the exact precache
 * list and a content-hash cache version, and writes the result to `dist/sw.js`.
 * See `docs/specs/pwa.md` and ADR 0018.
 */

const CACHE_PREFIX = "killingit-pwa";
const CACHE_VERSION = "__CACHE_VERSION__";
const PRECACHE_URLS = __PRECACHE_URLS__;
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const SHELL_URL = "/index.html";
const OFFLINE_URL = "/offline.html";

// The build precaches fingerprinted assets and public files. A pathname lookup
// keeps a query string (for example `?v=2`) from breaking the cache-first path.
const PRECACHE_PATHS = new Set(
  PRECACHE_URLS.map((url) => new URL(url, self.location.origin).pathname),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      // Do not skip waiting here. The page offers the athlete a reload, and
      // only then sends SKIP_WAITING so the shell never changes underneath a
      // running session.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== CACHE_NAME,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // The page compares this with the build it booted. An identical build means
  // the update arrived after the page already loaded it, so the waiting worker
  // can activate without a reload or an update banner.
  if (event.data?.type === "GET_BUILD_ID") {
    event.ports[0]?.postMessage({ type: "BUILD_ID", buildId: CACHE_VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Coaching data is per-account and may contain health information. The
  // service worker never reads, caches, or replays API responses.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/**
 * Network first, so a deployed shell reaches the next visit. The response also
 * refreshes the offline copy. When the network is unavailable, serve the last
 * shell, then the static offline page.
 */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    const contentType = response.headers.get("content-type") ?? "";
    if (
      response.ok &&
      contentType.includes("text/html") &&
      new URL(response.url).pathname !== OFFLINE_URL
    ) {
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(SHELL_URL)) ??
      (await cache.match(OFFLINE_URL)) ??
      Response.error()
    );
  }
}

/** Fingerprinted files never change under a URL, so a cached copy is final. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached !== undefined) {
    return cached;
  }
  return fetchAndCache(request);
}

/**
 * A small runtime cache for same-origin GETs that were not part of the build
 * (for example a future public file). Serve the cached copy immediately and
 * refresh it in the background.
 */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetchAndCache(request).catch(() => null);
  return cached ?? (await network) ?? Response.error();
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
