# ADR 0044: Resolve the API origin in one web module

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/web-api-base-url.md`, issue #310

## Context

The web app is served from the same origin as its API in development (a Vite
proxy) and in production, with an absolute `VITE_API_URL` origin for a
deployment that splits the two. Every module that called the API therefore
began with the same line:

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "";
```

That line had been copied into thirty modules, and every request concatenated
it into a URL. `instrument.ts` held a second, differently named copy for the
Sentry trace-propagation target. The duplication was invisible until a new
page was written or the origin configuration had to change: then the copies
had to be found and edited one by one, and a page that forgot the line would
quietly call the web server instead of the API.

## Decision

- Read `import.meta.env.VITE_API_URL` exactly once, in
  `apps/web/src/apiUrl.ts`. The module exports the resulting `API_BASE_URL` and
  a small `apiUrl(path, baseUrl = API_BASE_URL)` join.
- Make the authenticated request helpers own the join: `fetchJsonAuthed`,
  `requestParsed` and `fetchFileAuthed` take an API path and resolve it before
  fetching. A page cannot pass a wrong or missing origin because it no longer
  supplies one.
- Have `instrument.ts` read `API_BASE_URL` from the same module, so Sentry's
  trace target and the request helpers cannot drift apart.
- Enforce the single read with an ESLint `no-restricted-syntax` rule over
  `apps/web/**/*.{ts,tsx}`, with `apiUrl.ts` as the only exception. The rule is
  an error in the existing `bun run lint` invocation, so CI enforces it without
  a new job.

## Alternatives considered

- **Keep the copies and document the pattern.** The copies already differed in
  comments and placement, and nothing would catch a thirty-first one. Rejected.
- **Export `API_URL` from a module and keep `${API_URL}` at call sites.** This
  removes the duplication but leaves every call site responsible for
  remembering the prefix and for not accidentally writing an absolute URL.
  Rejected: the helpers already exist and can take the path.
- **Use a custom ESLint rule instead of `no-restricted-syntax`.** The built-in
  selector expresses the check in one config entry; a local rule would add a
  file, tests and maintenance for the same result. Rejected.
- **Make the base URL a runtime value read from the DOM or `window`.** The
  origin is a build-time fact for this app; a runtime lookup would add a
  configuration mechanism without a use case. Rejected.

## Consequences

- The API origin, the Sentry trace target and every request helper agree by
  construction, and changing the origin setup means editing one module.
- Call sites are shorter and read as paths: `/api/calendar?month=…`.
- `apiUrl` takes an optional base so the join is unit-tested; production
  callers never pass it.
- A deliberate second origin, such as a separate upload host, would need its
  own module-level constant rather than another `VITE_API_URL` read.
