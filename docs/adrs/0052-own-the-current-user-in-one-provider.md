# ADR 0052: Own the current user in one provider with a reload

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/current-user-provider.md`,
  `docs/specs/web-api-resource-hook.md`, issue #329

## Context

`AppShell` owned the signed-in account. It fetched `/api/me` in an effect,
stored the result in local state, derived the admin role and the diet-advice
flag from it, and passed the account plus two `setMe` patch callbacks through
`PageOutlet` to the Settings page. The location and diet-advice sections
patched `/api/me` themselves and reported the saved value back up, and the time
zone picker did the same in `SettingsPage`. Every new setting therefore added
another prop and another place that knew how to write the account.

The load also had no recovery. A failed `/api/me` left a bare
`Error: …` paragraph in the shell, and only a full page reload would try
again, even though the rest of the app was still usable.

## Decision

- Add `CurrentUserProvider` in `apps/web/src/CurrentUserProvider.tsx` above
  `AppShell`. It owns the `/api/me` load through `useApiResource`, so it gets
  the shared loading, error, abort and reload behaviour, and it exposes
  `useCurrentUser()` with `user`, `loading`, `error`, `update(patch)` and
  `reload()`.
- `update(patch)` is the only writer of `PATCH /api/me`. It sends the narrow
  `UserSettingsUpdate` patch, stores the account the API returns, and returns
  it to the caller. The provider's error slot is reserved for the load, so a
  failed save stays with the form that made it instead of offering a retry that
  would only reload the account.
- `CurrentUserLoadError` renders the failed load with a Retry that calls
  `reload()`. The shell keeps rendering the pages it can meanwhile.
- Pages read the account with `useCurrentUser()` rather than receiving it as a
  prop. `PageOutlet` keeps only the page, the plan refresh key, the time zone
  and their callbacks.
- The display time zone stays in `AppShell`. It is seeded from
  `user.timezone` and keeps the `timeZoneTouched` ref so a zone saved just
  before a late account load is not overwritten.
- Grouping `apps/web/src` by feature is not part of this decision. Moving the
  flat page files is tracked separately.

## Alternatives considered

- **Keep the props and add a retry.** The retry could live beside the error
  paragraph, but the account would still be drilled through the page registry,
  and each new setting would add another prop and another `/api/me` writer.
  Rejected.
- **Move the account into a general query cache.** The app has one resource of
  this shape and already has `useApiResource`; a cache dependency would add
  more machinery than the problem needs. Rejected for now.
- **Move the time zone into the provider too.** The saved zone is account
  state, but the _display_ zone has a touched override that belongs to the
  shell, and the value seeds `TimeZoneProvider` above every page. Keeping the
  override in the shell avoids moving the provider above the account provider
  for one consumer. Rejected.
- **Clear the provider error on navigation, as the old shell did.** That hides
  the only retry the app has. The error now survives navigation until the load
  succeeds. Accepted as a deliberate behaviour change.
- **Let each page keep patching `/api/me`.** That is the duplication being
  removed; a guard test now fails a module outside the provider that names the
  route (apart from account deletion).

## Consequences

- One module loads and writes the current user, and a failed load has a retry
  in the UI without reloading the app.
- A page that needs the location, diet advice or admin role calls
  `useCurrentUser()`; `PageOutlet` no longer forwards the account.
- A regression that loads or patches `/api/me` from a page fails
  `apps/web/src/currentUserAccess.test.ts`.
- The file-grouping half of issue #329 remains open and is tracked separately.
