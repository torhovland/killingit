# ADR 0035: Upstream failures own their HTTP status

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/api-errors.md`, issue #288

## Context

The API talks to three third-party services: the Garmin sidecar, Garmin itself
(through the sidecar) and OpenRouter. Failures from them are typed errors —
`GarminSidecarError`, `GarminAuthError`, `LlmProviderError` and its subclasses,
plus the credential failures the activity feed raises.

Each route translated those errors itself. `apps/api/src/routes/garmin.ts`,
`routes/coaching/feed.ts` and `routes/llm.ts` each held an `instanceof` ladder,
and the ladders disagreed: the feed answered every `LlmProviderError` with `503`,
while the LLM route passed a provider status through, and the feed logged the
credential failures that neither provider route logged. The three credential
classes meanwhile declared a `readonly status` that no route read.

Changing one status — which the next fix must do for credential failures — meant
editing every ladder and hoping none of them disagreed.

## Decision

- `apps/api/src/http/errors.ts` exports `UpstreamError`, an abstract `Error`
  that owns `status` (a service failure by default) and an optional `code`.
- The Garmin sidecar errors, the `LlmProviderError` family and the three
  credential failures extend it. A status the provider reported is carried by
  the error that reported it.
- `respondUpstreamError(c, err, logLabel)` is the one mapper. It answers with the
  error's status, message and code, clamps an impossible status the way
  `apiError` already did, logs a service failure, and logs and answers `503` for
  an error that is not an upstream failure. A route's whole `catch` is that one
  call.
- An upstream failure is logged only when it is answered as a service failure. A
  4xx asks the athlete to fix a connection, which is an expected answer rather
  than an incident.
- The status and code live with the failure's class, so reclassifying one family
  is one edit next to that family, not a change in every route.

## Alternatives considered

- **Keep one table mapping error class to status in the mapper.** Rejected:
  moving an `instanceof` ladder into a table still has to name every class, and
  a new class is still easy to forget.
- **Keep the per-route ladders.** Rejected: they had already drifted, and the
  next change to credential statuses would have to repeat itself in three
  places.
- **Return `null` from the mapper for an unexpected error and let the route log
  and answer.** Rejected: every route would repeat the same log-and-503 block,
  which is the duplication the refactor removes.
- **Log every upstream failure, including a 4xx.** Rejected: a rejected key or an
  unconnected account is a normal answer the athlete can act on, and logging it
  would turn a routine response into an error line.

## Consequences

- A route no longer imports a provider error class, so a status can change
  without touching a route.
- The same failure is now answered the same way everywhere: the activity feed
  passes an OpenRouter status through instead of always reporting `503`, and a
  Garmin or provider failure that carries no status keeps the failure's own
  message instead of the generic "Service Unavailable".
- A service failure is logged once by the mapper with the route's label, so the
  credential-key misconfigurations the feed reported are still visible in the
  logs.
- A provider-specific code can accompany the status; the credential failures
  will use it when they stop answering `401`.
