# Spec: One API base URL

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** ADR 0044, issue #310, `docs/specs/web-api-request-parsing.md`,
  `docs/specs/web-api-resource-hook.md`, `AGENTS.md`.

## Goal

Define the web app's API origin in exactly one module. A page or hook that
talks to the API passes an API path such as `/api/calendar?month=2026-11`; the
shared request helpers resolve it against the configured origin. No other file
reads `import.meta.env.VITE_API_URL`, and no call site can forget the base URL
or disagree about it.

Before this change the same line,

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "";
```

was copied into thirty modules under `apps/web/src`. Every request then built
its URL with `` `${API_URL}/api/...` ``. The copies had already started to
drift in comment and placement, and `instrument.ts` held a separate copy for
Sentry trace propagation. Adding or changing the way the origin is configured
meant editing all of them.

## Scope

### In scope

1. `apps/web/src/apiUrl.ts` owns the only `import.meta.env.VITE_API_URL` read
   and exports `API_BASE_URL` and `apiUrl(path, baseUrl?)`.
2. `fetchJsonAuthed`, `requestParsed` and `fetchFileAuthed` take an API path
   and resolve it with `apiUrl` before fetching.
3. `instrument.ts` reads `API_BASE_URL` from the same module for its Sentry
   trace-propagation target.
4. Every page, section and hook drops its local `API_URL` constant and passes
   a path.
5. An ESLint `no-restricted-syntax` rule fails `bun run lint` when any other
   web module reads `VITE_API_URL`.
6. Unit tests pin the join for a same-origin build, an absolute origin and a
   query string.

### Out of scope

- Changing where the origin is configured. `VITE_API_URL` stays the build-time
  environment variable, documented in `apps/web/src/vite-env.d.ts`.
- Changing request behaviour: bearer token, one-shot 401 renewal, contract
  version header, abort handling and error mapping are untouched.
- Moving the API client out of `apps/web/src` or adding a generated client.

## Design

```ts
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string, baseUrl: string = API_BASE_URL): string {
  return `${baseUrl}${path}`;
}
```

`API_BASE_URL` is empty for a same-origin build: the Vite dev server proxies
`/api` and production serves the app and the API from one host. A deployment
that serves them from different hosts sets `VITE_API_URL` to the API origin.

`fetchJsonAuthed` resolves the path once, before the token read, so the retry
after a 401 reuses the same URL. `fetchFileAuthed` does the same for binary
downloads. `requestParsed` passes its path straight through. The optional
`baseUrl` parameter on `apiUrl` exists so the join can be tested without
rebuilding the app with another origin.

`useApiResource` keeps the unresolved path as its effect key, which is stable
across builds and independent of the configured origin.

## Acceptance criteria

- `grep -rn "import.meta.env.VITE_API_URL" apps/web/src` matches only
  `apps/web/src/apiUrl.ts`; every other mention is prose.
- No module under `apps/web/src` builds an API URL by concatenating a base
  string; they pass paths.
- The resolved request URL is identical to the URL the app built before the
  change, for both the same-origin and the absolute-origin configuration.
- `bun run lint` rejects a new direct read of `VITE_API_URL` outside
  `apiUrl.ts`.
- `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`,
  `bun run test:coverage`, `bun run check:unused` and `bun run test:e2e` pass.

## Data model and API impact

None. The change is web-only; the API contract, routes and database schema are
unchanged.
