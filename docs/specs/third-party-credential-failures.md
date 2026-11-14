# Spec: third-party credential failures

- **Status:** Accepted (implemented)
- **Date:** 2026-11-14
- **Related:** `docs/specs/api-errors.md`, `docs/specs/openrouter-llm-integration.md`,
  `docs/specs/garmin-activity-integration.md`, `docs/specs/auth-integration.md`

## Goal

A rejected Garmin credential or OpenRouter key must not look like an expired
application session. The API answers it with a status the web client never
retries, a stable code the client can branch on, and the provider's message so
the athlete knows to fix the connection in Settings.

## Scope

### In scope

1. `UpstreamError` carries an optional `ApiErrorCode` in addition to its status,
   and `respondUpstreamError` passes it to `apiError`.
2. A rejected credential answers `409` with:
   - `garmin_auth_failed` for `GarminAuthError`, `GarminNotConnectedError`, and
     any `GarminSidecarError` whose status is `401`;
   - `llm_key_invalid` for `LlmAuthError` and any `LlmProviderError` whose
     status is `401`.
3. The Garmin not-connected answer in `routes/garmin.ts` uses the same
   credential failure instead of `unauthorized`.
4. `packages/shared/src/apiError.ts` accepts both codes.
5. The web's `fetchJsonAuthed` and `fetchFileAuthed` never renew the token for
   either code, even if a response regresses to `401`, and the existing error
   text shows the API's message.

### Out of scope

- Changing the session-authentication `401` from `requireAuth`, or a provider
  `403` such as Garmin's MFA requirement.
- A retry or reconnect flow that fixes the credential automatically.
- Changing the sidecar's own statuses; it still reports `401` for a failed
  Garmin login, and the API translates it.

## Design

`409` is used rather than `422`: `422` already means `validation_failed` for a
request body that failed schema validation, while a stored credential that the
provider rejects is account state that conflicts with the request. The provider
error classes own the translation, so the mapper stays one table and no route
repeats the rule.

Throwing `GarminNotConnectedError` from the route keeps the not-connected and
rejected-credential paths on one error type, message and code. The class lives
in `apps/api/src/garmin/credentials.ts`, beside the credential loader both
callers use.

## Acceptance criteria

1. `POST /api/garmin/credentials` with credentials Garmin rejects answers `409`
   and `{ error: { code: "garmin_auth_failed" } }`, and stores nothing.
2. `GET /api/garmin/activities` without a stored connection answers `409`
   `garmin_auth_failed`; a sidecar `401` is translated, while a sidecar `403`
   still answers `403`.
3. `PUT /api/llm/settings` with a rejected key and `GET /api/llm/models` with a
   provider `401` answer `409` `llm_key_invalid` and store nothing.
4. `GET /api/coaching/activities` without a Garmin connection or with a
   rejected key answers the same credential failures.
5. A `401` session failure still renews once in the web app; a credential
   failure does not.
6. API and web unit tests, typecheck, lint, format and the unused-export scan
   pass.

## Data-model / API impact

No schema or migration change. Two `ApiErrorCode` values are added to the
shared contract, and the status of the named failures changes from `401` to
`409`. The provider messages are unchanged.
