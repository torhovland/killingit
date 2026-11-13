# Spec: Shared API resource hook with real request aborts

- **Status:** Accepted (implemented)
- **Date:** 2026-11-13
- **Related:** `docs/specs/web-api-request-parsing.md`,
  `docs/specs/web-coaching-hooks.md`,
  `docs/specs/web-component-library.md`

## Goal

Replace the hand-written `loading` / `error` / `.then` / `.catch(reportError)`
effect that every data-backed web page repeated, and make a page load that is
superseded or unmounted actually cancel its HTTP request instead of merely
hiding the late result.

## Scope

### In scope

1. **`useApiResource(path, schema, action, options?)`** in
   `apps/web/src/useApiResource.ts` loads one authenticated, schema-validated
   GET through `requestParsed`. It owns the data, loading flag, error message,
   `reload`, `setData`, `setError` and the optional header-spinner
   registration. A `null` path means there is nothing to load yet.
2. **`useApiResources(requests, options?)`** loads several GETs as one atomic
   resource so a page that needs two related values (the integration statuses,
   the season review, the settings page) cannot render one new value beside a
   stale one. The request names are the keys of `data`.
3. **`useAbortableRequest(request)`** owns the controller for an imperative load
   whose result drives further work, such as the plan section's generation
   check and the regeneration buttons' advisory setup check. Its `abortAll`
   cleanup is what an effect returns.
4. Requests are aborted on a path change and on unmount. An aborted request
   never reaches state and never appears in the error slot.
5. `requestParsed`, `fetchJsonAuthed` and `fetchJson` forward
   `RequestInit.signal` to the native fetch. An already-aborted signal stops
   the bearer-token read and the one-shot 401 refresh before they start, so an
   aborted request cannot trigger a token refresh or a retry.
6. Migrate every page and hook that hand-wrote the pattern, and the
   `let cancelled` files under `apps/web/src` that load an API resource. The
   service worker's own `cancelled` flag in `PwaContext` is not an API request
   and stays.

### Out of scope

- Changing any page's rendered markup or the inputs that trigger a fetch.
- Aborting the activity-feed sync or the plan-generation polling, whose
  lifecycle is owned by `useActivityFeed` and `PlanGenerationProvider`.
- Adding a new dependency. The hook is typed against the existing structural
  `ResponseSchema<T>`, not against zod.

## Design

`useApiResource` is the single-request form:

```ts
const calendar = useApiResource(
  auth.isAuthenticated ? `${API_URL}/api/calendar?${query}` : null,
  calendarResponseSchema,
  "Loading the calendar",
  { statusSource: "calendar-page" },
);
```

The path is the effect key, so every input that should refetch belongs in it.
The hook does not take a dependency array: `react-hooks/exhaustive-deps` cannot
statically verify a spread or a caller-supplied list, and a path that encodes
the query is both simpler and harder to get wrong.

The core effect creates an `AbortController`, marks loading, clears the old
error, and runs the request. Every settle path checks `signal.aborted` first,
so a response that arrives after cleanup is dropped. The cleanup calls
`abort()`. `isAbortError` is the second guard for a rejection that came from an
abort even when the controller is no longer the one in scope.

`useApiResources` derives one key from its request paths and keeps the latest
request descriptors in a ref, so `Promise.all` loads both values and commits
them together. A partial failure leaves `data` unset.

The header spinner is registered through `useAppStatus` while `loading` is
true, and the effect's cleanup removes the source. A resource with no page
spinner omits `statusSource`.

## Acceptance criteria

- One implementation of abort, loading, error, reload and spinner registration
  for resource loads.
- A request aborted by a dependency change or an unmount does not set data,
  loading or an error, and does not report to Sentry.
- An already-aborted signal makes no network request, and an abort during a 401
  response does not trigger the token refresh or the retry.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test` and
  `bun run check:unused` pass, and the hook obeys
  `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` without a
  disable.
- Tests cover the abort plumbing (`fetchAuthed`, `fetchJson`, and the pure
  abortable-request runner). The repository has no hook-renderer dependency, so
  the hook's lifecycle itself is covered indirectly rather than by a new Testing
  Library dependency.

## Data model and API impact

None. The hook is web-only; the API contract, database schema and routes are
unchanged.
