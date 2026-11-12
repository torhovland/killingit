# Spec: Structured API request logs

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** `docs/adrs/0033-cloud-logging-request-lines.md`, issue #235,
  `docs/specs/api-server-entry.md`, `docs/specs/api-errors.md`

## Goal

Every request the API answers must leave one line in the deployment log that a
reader or a machine can filter without parsing prose. Hono's `logger()` writes
plain text, so Cloud Run stores unstructured lines and the deployment does not
meet the observability contract `AGENTS.md` describes.

## Format

One JSON object per request, written once the response is known:

```json
{
  "severity": "INFO",
  "time": "2026-11-12T16:58:55.993Z",
  "event": "request",
  "requestId": "66f2372a-3b17-43d6-9da2-d206a1c1df9f",
  "method": "GET",
  "path": "/api/health",
  "status": 200,
  "durationMs": 0
}
```

| Field        | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `severity`   | `INFO`, `WARNING` for a 4xx, or `ERROR` for a 5xx            |
| `time`       | When the line was written, RFC 3339 with milliseconds        |
| `event`      | `request` today; a future non-request line gets its own name |
| `requestId`  | Correlation id for the request (see below)                   |
| `method`     | HTTP method                                                  |
| `path`       | Request path without the query string                        |
| `status`     | Response status                                              |
| `durationMs` | Whole milliseconds from receiving the request to responding  |
| `error`      | Only on a thrown failure: `name`, `message`, and `stack`     |

`severity` and `time` are Cloud Logging's own field names, so Cloud Run parses
each line into a structured payload whose severity and timestamp are the ones
this line reports. The remaining fields are ours.

A thrown failure is reported in the same line as its request, including the
error stack, and is not printed a second time as plain text. Sentry still
captures the failure when a DSN is configured.

## Request id

- A caller-supplied `x-request-id` is reused when it is 1–128 characters of
  `A-Z`, `a-z`, `0-9`, `.`, `_` or `-`. Anything else is replaced, so a client
  cannot inject arbitrary text or a line break into the log.
- Otherwise the API generates a UUID per request.
- The id is echoed in the `x-request-id` response header, so a client report can
  be traced to its line.

## Privacy

The line never contains the query string, request headers, the body, or a
response body. Address searches (`/api/weather/geocode?q=…`), bearer tokens and
an athlete's own text therefore stay out of the log. The path can still name a
resource, which is intended: it is what makes the line useful.

## Scope

In scope:

1. `apps/api/src/instrumentation/requestLog.ts` owns the format and the
   middleware; `createApp` installs it on `*` in place of `hono/logger`.
2. The middleware accepts an optional writer so tests collect lines instead of
   printing them; production writes `INFO` to standard output and `WARNING` and
   `ERROR` to standard error.
3. Tests cover the field set and their types, the severity mapping, the request
   id rules, the error fields, and that the query string and body are absent.
4. `AGENTS.md` describes the implemented logging instead of a plan.

Out of scope:

- Converting the module-level `console.error("[plan] …")` failure notices to
  structured lines. They are diagnostic text with a prefix, not request logs,
  and changing them is a separate, much wider change.
- A logging dependency (Pino or similar). The format is a `JSON.stringify` of a
  fixed field set; a library would add configuration without changing a line.
- Log shipping, retention, sampling or alerting. Cloud Run and Cloud Logging
  already ingest standard output, and `scripts/agent.sh` still reads it.

## Acceptance criteria

1. A request through `createApp` writes exactly one valid JSON line.
2. The line carries `severity`, `time`, `event`, `requestId`, `method`, `path`,
   `status` and `durationMs`, and `error` when the handler throws.
3. A 4xx line is a warning and a 5xx line is an error.
4. No query string, header or body value appears in the line.
5. `scripts/agent.sh logs api` keeps working: the lines are one per request and
   `jq` can read them as they are.
6. Typecheck, lint, format, unit tests and the unused-export check pass.
