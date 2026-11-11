# ADR 0018: PWA app shell with a hand-built service worker

- **Status:** Accepted
- **Date:** 2026-11-04
- **Deciders:** torhovland

## Context

The web app is a React single-page application served as static files from
Cloudflare Pages. Until now it had no web app manifest and no service worker,
so it could not be installed and a network failure left the browser with
nothing to render. The product is used on phones around training sessions,
where connectivity is unreliable.

We need installability, an offline shell, and a way to deploy a new frontend
without leaving an installed app permanently on an old bundle. The existing
cache policy (`docs/specs/web-cache-busting.md`) already fingerprints assets
and revalidates `index.html`; the PWA layer must preserve that behaviour.

## Decision

Add a hand-built service worker rather than a Workbox or `vite-plugin-pwa`
dependency.

The worker source lives in `apps/web/pwa/service-worker.js`. A small Vite
plugin walks the final `dist/` directory at the end of the build, computes a
content-hash cache version, injects the exact precache URL list, and writes
`sw.js` to the build output. The worker:

- precaches every static file except source maps, host files, and itself;
- serves navigations network-first and falls back to the cached shell or
  `/offline.html`;
- serves static requests cache-first (precached) or stale-while-revalidate
  (other same-origin GETs);
- ignores `/api/*` and cross-origin requests;
- waits on update, so the athlete gets an update banner before the shell
  changes, unless the waiting worker is for the build the page already loaded.

Registration, install prompting, update prompting, and online/offline state
live in a React provider (`apps/web/src/PwaContext.tsx`). Registration is
production-only, so the Vite dev server is never cached.

Every production build stamps one content hash into both `index.html` (as the
`app-build` meta tag) and the worker (as `CACHE_VERSION`). Because navigations
are network-first, a visit after a deploy already loads the new shell, and the
update check it triggers finds a worker for that same build. Comparing the two
ids lets that worker activate silently instead of asking for a reload. Only a
worker for a different build — an app left open across a deploy — shows the
banner.

## Why not Workbox

Workbox and `vite-plugin-pwa` are mature, but they add a build dependency and a
generated service worker whose behaviour is harder to test in this repository.
The app has a single static origin and no runtime routing needs beyond app
shell, static assets, and API passthrough. A hand-built worker is roughly one
small module, keeps the cache policy explicit, and avoids a Vite 8 compatibility
question. If the caching requirements grow (background sync, precache
manifests, push), revisiting Workbox is reasonable.

## Consequences

- The app can be installed and launched standalone.
- Static assets and the shell survive a network failure; API-backed coaching
  still needs a connection.
- A visit after a deploy activates the new worker without an update banner,
  because the page and the worker share a build id. The banner now means the
  page itself is stale, which is the case it was meant for.
- Deploy branding changes require no dependency upgrade, only the manifest,
  icons, or worker source.
- The service worker is plain JavaScript outside the TypeScript project. Its
  build helper and the generated output are covered by tests, and ESLint runs
  it with service-worker globals.
- The worker cache is shared by all accounts on a device, so it must never
  contain API responses. That rule is part of the spec and a test asserts that
  `/api/*` stays out of the interception logic.
