# ADR 0033: Structured request logs in Cloud Logging's field vocabulary

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** torhovland
- **Related:** `docs/specs/api-logging.md`, issue #235

## Context

The API installed Hono's `logger()` middleware, which writes one plain-text line
per request. The deployment runs on Google Cloud Run, whose logs are Cloud
Logging entries: a line that is a JSON object is stored as a structured payload
and can be filtered on its fields, while a plain-text line can only be searched
as a string. Querying per-route latency or failure rates across a deployment
therefore needed text parsing.

The API already has a place for request-scoped instrumentation
(`apps/api/src/instrumentation/`), a shared error contract, and a dependency
policy that keeps the runtime small. Nothing in the API needs a logging
framework: the output is one fixed object per request.

## Decision

- Replace `hono/logger` with `requestLogger()`, a middleware in
  `apps/api/src/instrumentation/requestLog.ts`, installed on `*` before the
  routes.
- Use Cloud Logging's field names for the two fields that Cloud Logging
  interprets: `severity` (`INFO`, `WARNING`, `ERROR`) and `time` (RFC 3339).
  Every other field is ours and named plainly: `event`, `requestId`, `method`,
  `path`, `status`, `durationMs`, and `error` on a thrown failure.
- Derive severity from the status: a 5xx is an error, a 4xx is a warning, the
  rest is informational. Write informational lines to standard output and the
  rest to standard error.
- Reuse a caller's `x-request-id` when it passes a strict shape check, generate
  a UUID otherwise, and echo the id on the response. Log the path only, never
  the query string, headers or body.
- Report a thrown failure in its request's line, with name, message and stack,
  and drop the separate plain-text `console.error` in `onError`.
- No logging dependency.

## Alternatives considered

- **Keep Hono's `logger()` and add a prefix.** Rejected: a prefixed string is
  still unstructured, so Cloud Logging cannot filter on status or duration.
- **Adopt Pino (or another logger).** Rejected for now: it brings configuration,
  transports and a dependency for a fixed field set that `JSON.stringify`
  already produces. The module can be swapped for a library later without
  changing the line format.
- **Log a `level` field and a separate `timestamp`.** Rejected: Cloud Logging
  would then fall back to ingestion time and stream-derived severity instead of
  the values the line reports, which loses filtering on exactly the fields a
  reader cares about.
- **Log the full URL to make route patterns obvious.** Rejected: geocoding
  queries carry the athlete's home address and other query parameters can carry
  athlete text. The path is enough to identify the route.
- **Trust any incoming `x-request-id`.** Rejected: an unvalidated header would
  let a caller write arbitrary content into the log line.

## Consequences

- Cloud Run parses each request into a structured entry with the reported
  severity and time, so logs can be filtered by status class, path and request
  id. `scripts/agent.sh logs api` keeps working and its output is valid JSON.
- Every response now carries an `x-request-id` header, which gives the web app a
  correlation handle if it later reports a failure.
- The middleware logs once, after the response, so a long request appears when
  it finishes rather than when it starts.
- Module-level failure notices (`console.error("[plan] …")`) stay plain text
  until they are converted in a separate change.
- A stream failure while writing a line would surface from the middleware; Node
  and Bun streams do not reject a write to a closed pipe in normal operation,
  and a log write must never turn a successful response into a failure. This is
  accepted as a residual risk rather than guarded with a try/catch around every
  write.
