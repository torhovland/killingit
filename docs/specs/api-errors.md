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

### Upstream failures

An error from an upstream dependency — the Garmin sidecar or the LLM provider —
carries the HTTP status the API answers with. The base class,
`UpstreamError` in `apps/api/src/http/upstreamError.ts`, holds that `status`,
an optional `code` and the message; a provider reports one when it answered the
request, such as 403 when Garmin needs MFA, 429 for rate limiting or 502 for a
gateway failure. The status is optional because a failure such as a timeout has
no answer of its own.

`respondUpstreamError(c, err, { log })` in `apps/api/src/http/errors.ts` is the
single mapper. No route repeats an `instanceof` ladder for provider errors:

| Error                                           | Response                                             |
| ----------------------------------------------- | ---------------------------------------------------- |
| `GarminSidecarError`, `LlmProviderError`        | the provider's own status and message, else 503      |
| `GarminAuthError`, `GarminNotConnectedError`    | 409 `garmin_auth_failed` with the provider's message |
| `LlmAuthError`                                  | 409 `llm_key_invalid` with the provider's message    |
| `GarminCredentialsError`, `LlmCredentialsError` | 503 with the configuration message, also logged      |
| anything else, or an upstream error without one | 503 `Service Unavailable`, logged through the route  |

`UpstreamConfigurationError` marks a failure in the API's own configuration,
such as a stored credential that cannot be decrypted, so the mapper logs it
even though it answers with a status. Every other failure without a usable
status is logged through the route's own `log` callback, which keeps the
existing label (`[garmin] activities failure:`, `[llm] provider failure:`, …)
on the line.

A status outside the failure range is not echoed: `apiError` turns it into a
503, so a misbehaving provider cannot make the API answer 2xx or 3xx for a
failure.

### Third-party credential failures

A rejected credential is not an authentication failure of the API session.
Answering `401` would make the web client renew the token and retry a request
the athlete can only fix in Settings. The API therefore answers every
third-party credential failure with `409` and a specific code; the provider's
own `401` is translated by its error class, and a raw `LlmProviderError` or
`GarminSidecarError` with status 401 is translated the same way:

| Failure                                                                   | Status | Code                 |
| ------------------------------------------------------------------------- | ------ | -------------------- |
| Garmin missing or rejected (`GarminAuthError`, `GarminNotConnectedError`) | 409    | `garmin_auth_failed` |
| OpenRouter key rejected (`LlmAuthError`, provider 401)                    | 409    | `llm_key_invalid`    |

`409` is chosen over `422` because `422` already means `validation_failed` for
a request body that failed schema validation, and because the credential is
stored account state that conflicts with the request rather than a malformed
request. A genuinely unauthenticated request keeps its `401` from
`requireAuth`, and a provider `403` such as Garmin's MFA requirement keeps its
`403`.

The web client treats `garmin_auth_failed` and `llm_key_invalid` as credential
failures: `fetchJsonAuthed` and `fetchFileAuthed` never renew the session for
them, even if a response regresses to `401`, and the page shows the API's
message so the athlete knows to fix the connection. A `401` without one of
those codes still gets the one-shot token refresh. See
`docs/specs/third-party-credential-failures.md`.

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
with `400`, matching the library's existing status. A third-party credential
failure keeps the general `409` status but overrides the default `conflict`
code with `garmin_auth_failed` or `llm_key_invalid`.

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
5. Every upstream failure goes through `respondUpstreamError`, which preserves
   the status and message the provider reported, adds the error's stable code
   when it has one, and logs the failures that have none, so no route keeps its
   own `instanceof` ladder.
6. A third-party credential failure answers `409` with `garmin_auth_failed` or
   `llm_key_invalid`, never `401`, and the web client does not renew the
   session for it.
7. The API and web test suites, typecheck, lint and format pass.
