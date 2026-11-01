# Spec: Web cache busting after a frontend deploy

- **Status:** Accepted (implemented)
- **Date:** 2026-11-01
- **Related:** `docs/adrs/0001-hosting-cloud-run-neon-cloudflare.md`, `README.md`
  (Hosting).

## Goal

Serve a newly deployed frontend on the next visit. The browser must never reuse
an app shell from a previous deployment, and a page that is still open from a
previous deployment must keep working instead of requesting files the new
deployment no longer has.

## Scope

### In scope

1. `apps/web/public/_headers` ships a Cloudflare Pages cache policy with every
   deploy (`public/` is copied into `dist/` by Vite).
2. Everything the shell can be served from (`/`, `/index.html`, and deep links
   rewritten through the SPA fallback in `_redirects`) is sent with
   `Cache-Control: no-cache`, so the browser revalidates it before every use.
3. Everything under `/assets/*` is sent with
   `Cache-Control: public, max-age=31536000, immutable`. Vite content-hashes
   those filenames, so a new build gets new URLs and an old one can be cached
   forever without ever being confused with a new file.
4. `apps/web/src/webCacheHeaders.test.ts` asserts the policy so a later edit
   cannot quietly start caching the shell or stop fingerprinting the bundle.

### Out of scope

- Detecting a deploy in an already-open tab. The shell is revalidated on the
  next navigation and a reload picks up the new build; an open tab keeps the
  bundle it booted with until it reloads.
- Cache headers for API responses; the API is served by Cloud Run, not Cloudflare
  Pages, and its responses are per-account.
- Service workers or offline caching. The app has none.

## Why this policy

Vite writes a content hash into every bundle filename, so assets are already
cache-busted: `index.html` is the only file whose URL stays the same while its
content changes. It is also the only file that names the current bundle, so it
must never be reused without a round trip. Cloudflare Pages' default
(`public, max-age=0, must-revalidate`) is close, but it is a default that can
change, and it also applies to the fingerprinted assets, which then get
revalidated on every load.

Caching the fingerprinted assets for a year also protects a page that is still
open from an earlier deploy: its cached bundle stays available locally even
though the new deployment no longer serves that filename, and the SPA fallback
would otherwise answer such a request with `index.html` and a 200.

## Acceptance criteria

1. `GET /`, `GET /index.html`, and a deep link such as `GET /settings` revalidate
   the shell; none is served as immutable or with a positive `max-age`.
2. `GET /assets/index-<hash>.js` is served with
   `Cache-Control: public, max-age=31536000, immutable`.
3. A new deploy changes the hashed bundle URL in the shell, so the browser
   requests new assets, while unchanged assets can come from cache.
4. `bun run test` covers the `_headers` policy, and
   `bun run typecheck && bun run lint && bun run format` pass.
