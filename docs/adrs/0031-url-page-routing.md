# ADR 0031: URL page routing with a minimal history binding

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** torhovland
- **Related:** `docs/specs/web-routing.md`, issue #181

## Context

Top-level navigation lived in component state: `App.tsx` held a `Page` union,
a React context carried `setPage` to the pages that needed it, and a chain of
nested ternaries chose the component. Every page therefore had the same URL, so
refresh, bookmarks, shared links and the browser's back and forward buttons all
returned to the coaching dashboard. The chain also made a new page touch three
places.

The app has one flat level of pages with no nested layouts, loaders or data
dependencies. Cloudflare Pages already rewrites unknown paths to `index.html`,
and the PWA navigation handler already serves the cached shell for any path, so
the hosting layer supports deep links without a change.

## Decision

- Represent every page once in `PAGE_DEFINITIONS` in
  `apps/web/src/navigation.tsx` with its path, menu label and content width.
  Derive the `Page` type from that record.
- Bind React to the History API with `useSyncExternalStore`: `pushState` for a
  navigation, `replaceState` for a redirect, `popstate` for back and forward.
  No routing library.
- Map each page to its component in one `Record<Page, PageRenderer>` in
  `apps/web/src/PageOutlet.tsx`, replacing the ternary chain.

## Alternatives considered

- **React Router.** Rejected for now: the app has no nested routes, route
  parameters, loaders or data APIs that would justify the dependency and its
  conventions. A flat pathname lookup is a few lines and is covered by a pure
  test.
- **Hash routing (`#/settings`).** Rejected: it keeps the URL out of the server
  path, breaks the clean SPA fallback the host already provides, and makes
  shared links uglier without any benefit.
- **Keep pages in component state and only sync `pushState`.** Rejected: the
  URL would still be a side effect of state rather than the source of truth, so
  back and forward could not drive rendering.
- **Use the router's data APIs to load page data.** Rejected: each page already
  owns its fetches and request lifecycle. Moving that into loaders would be a
  larger change with no benefit at this size.

## Consequences

- Refresh, bookmarks, shared links and history buttons work on every page.
- Adding a page is a definition entry and a registry entry, and the compiler
  finds any missing label or path.
- The page is now observable in tests through the URL instead of only rendered
  output.
- The router is deliberately flat. A future per-activity page needs either a
  parameter-aware matcher or a real router; that decision is deferred.
- Redirects use `replaceState`, so the back button does not bounce between a
  guard and the page it rejected.
