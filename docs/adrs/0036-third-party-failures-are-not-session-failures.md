# ADR 0036: Third-party connection failures are not session failures

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/api-errors.md`,
  `docs/adrs/0035-upstream-failures-own-their-status.md`, issue #289

## Context

The API reports a missing app session and a broken third-party connection with
the same `401`. Garmin credentials Garmin rejects, an OpenRouter key the
provider rejects, and an account with no Garmin connection all answered `401`,
exactly like an expired bearer token.

A client cannot then tell the two apart. The web app treats every `401` as an
expired session: `fetchJsonAuthed` renews the token with the provider's cache
bypassed and retries the request once, which cannot help when the problem is a
revoked Garmin password. The retry costs a token refresh and a request, and it
hides the real answer from the code that reads the failure.

ADR 0035 left each upstream failure owning its status and an optional code,
noting that the credential failures would use a code when they stopped
answering `401`. This is that change.

## Decision

- `401` keeps exactly one meaning: the request has no usable app session. Only
  the authentication middleware and its `unauthorized` helper answer it.
- A third-party connection the athlete can fix is a `4xx` with its own code:

  | Failure                    | Status | Code                   |
  | -------------------------- | ------ | ---------------------- |
  | Garmin has no stored login | `409`  | `garmin_not_connected` |
  | Garmin rejects the login   | `422`  | `garmin_auth_failed`   |
  | OpenRouter rejects the key | `422`  | `llm_key_invalid`      |

- `422` is the credential itself being unusable, whether it was just submitted
  or stored earlier. `409` is the account's state lacking a connection at all.
  Both are answers the athlete acts on in Settings, so neither is logged as an
  incident (ADR 0035).
- The three codes join the shared `ApiErrorCode` union, because a web client
  can point the athlete at the right settings section without reading the
  message text.

## Alternatives considered

- **Keep `401` and let the client read the code.** Rejected: a client that
  refreshes on `401` must first learn the exception, and every future client
  would have to repeat it. The status is the coarse signal, so it should be
  right.
- **Use `401` for a stored credential and `422` only for a submitted one.**
  Rejected: the athlete's fix is the same in both cases, and one failure would
  then have two answers depending on which route raised it.
- **Use `403` for a rejected credential.** Rejected: `403` means the account
  is authenticated but not allowed, which is a role answer, not a credential
  the provider refused.
- **Report a missing Garmin connection as `404`.** Rejected: the resource is
  the athlete's connection, not a path segment, and `404` reads as a routing
  bug.

## Consequences

- A `401` from the API now always means the session, so the web's renew-and-
  retry is no longer spent on a broken connection.
- The credential failures carry a stable code, so the web can later link
  straight to the Garmin or OpenRouter section instead of only showing text.
- The Garmin sidecar still maps Garmin's rejection to `401` towards the API;
  the API translates it into `422` at the boundary that knows it is talking
  about the athlete's connection rather than the caller's session.
- A provider status that is not an authentication failure (`403` MFA required,
  `429`, `502`, `402`) keeps passing through as before.
