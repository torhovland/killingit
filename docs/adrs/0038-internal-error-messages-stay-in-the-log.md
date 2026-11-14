# ADR 0038: Internal failure messages stay in the log

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** torhovland
- **Related:** `docs/specs/api-errors.md`, `docs/specs/diet-log.md`,
  `docs/adrs/0035-upstream-failures-own-their-status.md`, issue #298

## Context

The API answers a failed request with the shared error contract, and the web app
shows `error.message` to the athlete. That is right for a message the API wrote
on purpose. It is wrong for a message that came from the runtime: `err.message`
also carries a database error, a failed JSON parse, or a missing environment
secret.

Four places still handed a caught error's own message to the athlete:

- `routes/diet.ts` stored any `err.message` as `food_entries.analysis_error`,
  which the Diet page shows and the coach's next prompt reads.
- `routes/garmin.ts` and `routes/llm.ts` echoed the error from deriving the
  credentials encryption key, so a response could say
  `GARMIN_CREDENTIALS_KEY must be set to enable this integration`.
- `coaching/feed/presenter.ts` had its own `instanceof LlmProviderError` ladder
  for an activity analysis that failed.
- `plans/` stored any `err.message` as the generation error that the plan
  section shows, and reused it for the admin's prompt log.

Each site decided for itself which failures an athlete may see, so a new error
class or a new call site could leak again.

## Decision

- `apps/api/src/http/errors.ts` exports `AthleteFacingError`, an abstract `Error`
  whose message is written for the athlete. `UpstreamError` extends it, and so
  does `LlmModelChoiceError`, whose message tells the athlete which Settings
  change to make.
- `athleteFailureMessage(err, { fallback, logLabel })` is the one mapping for
  text an athlete sees outside the standard error contract — a stored
  `analysisError`, or the message of a response whose failure is not a provider
  failure. A known athlete-facing failure keeps its own message. Any other
  failure is an internal detail: the mapper logs the real error under the
  caller's label and returns the caller's fallback sentence.
- The log decision matches `respondUpstreamError` (ADR 0035): an upstream `4xx`
  is the athlete's to fix and stays out of the error log, while an upstream
  service failure and every internal failure are logged.
- A route never builds an athlete-facing string from `err.message`. A provider
  failure goes through `respondUpstreamError`; anything else goes through
  `athleteFailureMessage` with a fallback that reads as the reason.

## Alternatives considered

- **Replace every failure with one generic sentence.** Rejected: it hides an
  actionable answer such as an invalid OpenRouter key, insufficient credits, or a
  retired model the athlete must replace in Settings.
- **Keep echoing `err.message` and rely on review.** Rejected: the message can
  name an environment secret or repeat a database's own words, and the Diet page
  stores it for later prompts.
- **A per-route `instanceof` ladder.** Rejected: that is what the feed already
  had, and it drifted from the routes the moment a new error class appeared.

## Consequences

- A database failure, a malformed provider answer, or a missing environment
  secret reaches the log with the caller's label and not the athlete's screen.
- The athlete still sees messages they can act on: a rejected credential, a
  missing Garmin connection, a provider rate limit, or a retired model.
- A failed plan run stores the same way: the generation row carries the
  athlete-facing reason (`plans/failure.ts`), while the prompt log and the
  server log keep the raw failure for the admin.
- A stored `analysisError` is now a sentence fit for the Diet page and for the
  next coach prompt. A later meal analysis reports a generic reason when the
  earlier one failed internally, instead of feeding it a stack-level message.
