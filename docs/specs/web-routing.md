# Spec: URL-based page routing

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** `docs/adrs/0031-url-page-routing.md`,
  `docs/specs/dashboard-layout.md`, `docs/specs/pwa.md`,
  `docs/specs/web-cache-busting.md`, issue #181

## Goal

Give every top-level page its own URL. A refresh, a bookmark, a shared link,
and the browser's back and forward buttons all land on the intended page
instead of the coaching dashboard. Adding a page must not edit a nested
ternary chain.

## Routes

| Page          | Path             |
| ------------- | ---------------- |
| Coach         | `/coach`         |
| Diet          | `/diet`          |
| Fitness       | `/fitness`       |
| Calendar      | `/calendar`      |
| Activities    | `/activities`    |
| Season review | `/season-review` |
| Survey        | `/survey`        |
| AI costs      | `/costs`         |
| Settings      | `/settings`      |
| Admin         | `/admin`         |

## Scope

### In scope

1. One page definition per page in `apps/web/src/navigation.tsx`, holding its
   path, account-menu label and whether it uses the wide content panel. The
   `Page` type is derived from those definitions, so a page cannot exist
   without a path and label.
2. A minimal `useSyncExternalStore` binding to the History API: the account
   menu pushes a history entry, back and forward arrive as `popstate`, and the
   app renders the page for `window.location.pathname`.
3. A page registry in `apps/web/src/PageOutlet.tsx` mapping every page to its
   component, replacing the nested ternaries in `App.tsx`.
4. Redirects written as `replaceState` so they do not trap the back button:
   - `/` and any unknown path go to `/coach`;
   - an incomplete coaching survey goes to `/survey` from any other page;
   - a signed-in member who opens `/admin` goes to `/coach`.
5. The header logo and the account menu keep their labels but now change the
   URL. The calendar keeps the wider content panel, expressed in its page
   definition.
6. Existing view-level component tests stay unchanged; routing behaviour is
   covered by pure path-mapping tests and the Playwright suite (deep link,
   reload, back and forward).

### Out of scope

- Per-activity or per-day URLs. The router is top-level only; the calendar
  dialog still opens in place.
- Nested routes, loaders, data routers, or a routing library. The app needs one
  flat level of pages.
- Manifest shortcuts. The routes now make them possible, but no shortcut is
  added in this change.
- Server-side rendering or a server route table. Cloudflare Pages' SPA fallback
  already serves the shell for every path.

## Behaviour

- `navigateToPage(page)` pushes the page's path unless it is the current path,
  then notifies the path store. `replace: true` is used for redirects.
- Trailing slashes are tolerated when reading a path (`/settings/` opens
  Settings); the canonical path is written without one.
- A page change does not reload the shell: only the URL changes, so in-flight
  requests, a running plan generation and the header spinner survive.
- The survey gate and the admin guard are the existing rules; they now change
  the URL instead of component state. Reloading `/survey` keeps the survey page
  even after every answer is saved, because the survey is a real page with a
  real URL (the old in-memory page reset to the dashboard on reload).
- Signing in returns to the path the visitor requested, because the Auth0
  adapter already asks Auth0 to return to `window.location.pathname`.

## Acceptance criteria

1. Each page has the path in the table and keeps it across refresh, back and
   forward.
2. The nested ternary chain is gone; every page is one registry entry plus its
   definition entry.
3. `/` and unknown paths redirect to `/coach`; `/admin` redirects a member to
   `/coach`; an incomplete survey redirects to `/survey`.
4. Pure tests cover the path mapping, label lookup and the calendar's wide
   panel; the e2e suite covers a deep link after sign-in, reload and the history
   buttons.
5. `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
   `bun run test:e2e` pass.

## Data model and API impact

None. This is a frontend-only change; no API route, database schema or prompt
changes.
