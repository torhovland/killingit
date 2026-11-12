# Spec: API error responses

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** `docs/specs/api-versioning.md`,
  `docs/specs/web-api-request-parsing.md`,
  `docs/specs/authenticated-user-middleware.md`

## Goal

Every failed API request answers with one predictable shape, so the web client
can show the server's own message, and future clients can branch on a stable
code, without parsing prose or guessing a route's phrasing.

## Scope

### In scope

1. The shared contract in `packages/shared/src/apiError.ts`:

   ```json
   {
     "error": {
       "code": "validation_failed",
       "message": "The request is not valid",
       "details": { "issues": [] }
     }
   }
   ```

   `code` is one of the `ApiErrorCode` values, `message` is a short sentence
   suitable for display, and `details` is optional structured context (field
   issues, the version mismatch, the settings URL).

2. API helpers in `apps/api/src/http/errors.ts`: the generic `apiError` plus
   `badRequest`, `validationFailed`, `unauthorized`, `forbidden`, `notFound`,
   `conflict`, `serviceUnavailable` and `badGateway`. Each route imports these
   instead of calling `c.text(...)` with a status.

3. A validating `zValidator` wrapper in `apps/api/src/http/validation.ts`. It
   keeps the library's typed `c.req.valid(...)` but replaces its default
   `{ success, error }` payload with the error contract and code
   `validation_failed`.

4. The global handler maps `LlmModelChoiceError` to a `409` contract response
   with `details.settingsUrl`, instead of its own `{ error, settingsUrl }`
   shape. The API-version handshake also answers with the contract, keeping
   `requiredVersion` and `receivedVersion` in `details`.

5. `apps/web/src/fetchJson.ts` reads the contract while staying tolerant of a
   plain-text body. `ApiError` exposes `code` and `details`, and its `message`
   is the server's `error.message` when the body is the contract. A plain-text
   or non-contract body keeps the existing diagnostic message. File downloads
   in `fetchAuthed.ts` use the same parser.

### Out of scope

- Changing which status each failure uses. The refactor preserves the existing
  statuses and wording.
- Localising messages. The API sends English and the web shows it as-is.
- A second, richer error taxonomy. One code per failure kind is enough.

### Last-resort 500

Hono's `onError` fallback keeps replying with plain text
`Internal Server Error`, as the issue requires. That path is for a bug the API
did not expect; it carries no structured context to show.

## Status-to-code mapping

| Status | Code                   |
| ------ | ---------------------- |
| 400    | `bad_request`          |
| 401    | `unauthorized`         |
| 402    | `payment_required`     |
| 403    | `forbidden`            |
| 404    | `not_found`            |
| 409    | `conflict`             |
| 422    | `validation_failed`    |
| 426    | `api_version_mismatch` |
| 429    | `too_many_requests`    |
| 502    | `bad_gateway`          |
| 503    | `service_unavailable`  |

A validation failure from the `zValidator` wrapper uses `validation_failed`
with `400`, matching the library's existing status.

## Acceptance criteria

1. A route failure has `content-type: application/json` and the contract shape;
   no route calls `c.text(...)` for a failure.
2. A rejected request body or path parameter produces `400` with
   `code: "validation_failed"` and the Zod issues under `details.issues`.
3. The web app displays `ApiError.message`, which equals the API's
   `error.message` for a contract response, and still surfaces a plain-text
   body's text.
4. `ApiError` carries the response `code` and `details` for callers that want
   to branch on them.
5. The API and web test suites, typecheck, lint and format pass.
