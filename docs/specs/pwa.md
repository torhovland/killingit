# Spec: Installable PWA with an offline app shell

- **Status:** Accepted (implemented)
- **Date:** 2026-11-04
- **Related:** `docs/adrs/0018-pwa-app-shell.md`,
  `docs/specs/web-cache-busting.md`, `docs/specs/auth-integration.md`,
  `docs/specs/dashboard-layout.md`

## Goal

Make the web app a complete installable progressive web app. An athlete can
install it on a phone or desktop, launch it full screen, keep using the last
loaded app shell when the network drops, and receive an explicit prompt when a
new deployment is ready.

## Scope

### In scope

1. A web app manifest (`apps/web/public/manifest.webmanifest`) with the app
   name, short name, description, start URL, scope, standalone display mode,
   brand theme/background colours, and 192 px, 512 px, maskable 512 px, and SVG
   icons.
2. Install metadata in `index.html`: the manifest link, application name,
   description, Apple mobile web app tags, a `viewport-fit=cover` viewport, and
   Safari's mask icon.
3. A service worker generated from `apps/web/pwa/service-worker.js` at build
   time by `apps/web/pwa/buildServiceWorker.ts`. The build injects the complete
   list of static build output files and a content-hash cache version.
4. Service worker strategies:
   - install: precache the whole static build output (shell, fingerprinted
     assets, fonts, icons, manifest, offline page);
   - navigation requests: network first, update the cached shell from the
     response, and fall back to the cached shell and then `/offline.html`;
   - static same-origin requests: cache first for precached URLs, stale-while-
     revalidate for anything else same-origin;
   - `/api/*` and cross-origin requests: never intercepted or cached.
5. An explicit update flow: a new service worker waits, the app shows an update
   banner, and the athlete's reload sends `SKIP_WAITING`. The page reloads once
   the new worker controls it. Failed update checks are silent.
6. Install UI: a header action when the browser offers installation, plus an
   install section in Settings that explains the state and the browser action.
7. Offline UI: a global banner while `navigator.onLine` is false and a static
   `/offline.html` page for a cold navigation with no cached shell.
8. Standalone polish: safe-area padding and status-bar metadata so the shell
   does not sit under a notch or home indicator.
9. Cache headers: `/sw.js` is explicitly revalidated (no HTTP caching), while
   the existing immutable rule for `/assets/*` remains.
10. Tests and documentation for every guarantee above.

### Out of scope

- Offline writes, background sync, and retrying mutations when the connection
  returns. Coaching is generated server-side and every action still requires a
  live API connection.
- Caching API responses. They are per-account and may contain health and
  training data, so the service worker never stores them. The dashboard's
  existing account-scoped `localStorage` activity cache is unchanged.
- Push notifications, periodic background sync, and native app packaging.
- Manifest shortcuts and URL-based deep links. Pages are still selected in
  memory, so every shortcut would land on the dashboard.
- Detecting a deploy in an already-open tab without the update banner. The
  banner is the supported path; a normal reload also picks up the new shell.

## Service worker lifecycle

1. `main.tsx` mounts `PwaProvider`, which registers `/sw.js` in production only.
   The Vite dev server is never controlled by a service worker.
2. The browser installs the worker, which opens the versioned cache and
   precaches every URL in the generated list.
3. On first install there is no active worker, so the new worker activates
   immediately and claims the page. On an update it waits.
4. When an update is waiting (or appears while the app is open), the provider
   shows "A new version of Killing It is ready". Reload sends `SKIP_WAITING` and
   the page reloads on `controllerchange`.
5. `activate` deletes older caches with the same prefix and claims clients.
6. While the app is visible, the provider asks the browser to check for an
   update at most once an hour.

## Privacy

The service worker cache contains only same-origin static files that are
identical for every athlete. It never sees API requests, so a shared device
cannot show one account's data from the cache to another. The offline page and
shell contain no athlete data.

## Acceptance criteria

1. A production build contains `/sw.js`, `/manifest.webmanifest`,
   `/offline.html`, the icons, and a precache list that includes every static
   build file except source maps, `_headers`, `_redirects`, and `sw.js` itself.
2. The cache name changes when any precached file changes.
3. `GET /` is served by the network when online and from the precached shell
   when offline; a cold navigation without a shell reaches `/offline.html`.
4. `/api/*` and cross-origin requests are not intercepted.
5. The manifest is valid JSON with `display: "standalone"`, a `/` start URL and
   scope, brand colours, and existing 192/512/maskable icons.
6. `index.html` links the manifest, exposes the Apple install metadata, and uses
   `viewport-fit=cover`.
7. `_headers` keeps `/sw.js` out of the browser HTTP cache.
8. The header shows an install action only when installation is offered and the
   app is not already installed. Settings explains install state otherwise.
9. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`, and
   `bun run build` pass.
