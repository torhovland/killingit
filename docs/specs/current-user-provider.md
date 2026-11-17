# Spec: Current user provider

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** issue #329, `docs/adrs/0052-own-the-current-user-in-one-provider.md`,
  `docs/specs/web-api-resource-hook.md`,
  `docs/specs/web-interaction-tests.md`.

## Goal

Give the signed-in account one owner in the web app, so pages no longer receive
it through a growing prop list and a failed `/api/me` load can be retried from
the UI instead of leaving a dead error paragraph.

## Scope

### In scope

1. `CurrentUserProvider` in `apps/web/src/CurrentUserProvider.tsx` wraps
   `AppShell`. It loads `/api/me` with `useApiResource`, so the request is
   aborted on sign-out and unmount and keeps the shared loading and error
   state.
2. `useCurrentUser()` exposes `user`, `loading`, `error`, `update(patch)` and
   `reload()`.
3. `update(patch)` accepts the shared `UserSettingsUpdate` shape, sends
   `PATCH /api/me`, stores the returned account, clears a stale load error and
   returns the saved account. It is the only current-user writer, apart from
   account deletion's `DELETE /api/me`.
4. `CurrentUserLoadError` renders the failed load with a Retry that calls
   `reload()`.
5. `AppShell` keeps the catalog refresh, the header spinner source and the
   plan refresh key, and reads `user` from the provider for the admin role. The
   display time zone lives in `useTimeZoneState` and the survey gate with its
   redirect effects in `useRouteGuards`, both at the web root beside the shell.
   `AppHeader`, `UserMenu` and `AppBody` hold the header, the account menu and
   the gated page region.
6. `PageOutlet` receives only the page, the plan refresh key, the time zone
   and the callbacks those need. Pages that need the account read it from the
   provider.
7. `SettingsPage` reads the location, diet-advice and role values from the
   provider and saves through `update`. `LocationSection` and `DietSection`
   keep their local draft and progress state but delegate the save.
8. A guard test,
   `apps/web/src/currentUserAccess.test.ts`, fails a source module outside the
   provider that names `/api/me`, except account deletion.

### Out of scope

- Grouping the flat `apps/web/src` files into feature directories. That
  mechanical move is tracked in its own issue and keeps the page components
  flat until then.
- Changing the `/api/me` response or request contract.
- Moving the display time-zone override into the provider.

## Behaviour

- A signed-in page reads the account from the provider. Before it loads the
  account is null, as before.
- `update()` changes the provider's account without a second GET; the change
  reaches every page at once and the caller still gets the saved value.
- A failed load shows the error and a Retry; Retry refetches and clears the
  error on success. Navigation no longer clears the error, because the retry
  is the only recovery path.
- A failed save does not set the provider error. The section that made the
  save shows its own message and keeps the athlete's unsaved input.
- Signing out clears the account and the time zone, and the next account
  starts from its own saved zone.

## Acceptance criteria

- `useCurrentUser` outside the provider throws a named error.
- The provider tests cover the initial load, `update()` without a refetch, a
  failed load with a successful Retry, and a manual `reload()` that picks up a
  changed account.
- `SettingsPage` tests clear the location and toggle diet advice, asserting the
  `PATCH /api/me` bodies and the rendered result.
- `PageOutlet` has no user prop and `AppShell` holds no `me` state.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run check:unused` and `bun run test:e2e` pass.

## Data model and API impact

None. The web reads the existing `GET /api/me` and writes the existing
`PATCH /api/me`; no route, schema or database change.
