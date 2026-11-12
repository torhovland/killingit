# Spec: Bounded completions for one coach call

- **Status:** Accepted (implemented)
- **Date:** 2026-11-12
- **Related:** ADR 0004, `docs/specs/openrouter-llm-integration.md`,
  `docs/specs/llm-call-log.md`, `docs/specs/llm-model-catalog.md`.

## Goal

Bound the completions billed to the athlete's own OpenRouter key and the time a
single coach call may spend. A model that keeps truncating, keeps rejecting the
request, or keeps returning unusable JSON must fail after a small, predictable
number of attempts instead of billing the whole fallback chain for every level
of a plan build.

## Problem

`completeWithFallbacks` walked seven attempt configurations, and
`completePlanJson` wrapped it in up to three JSON repair turns. One plan level
could therefore issue about 21 completions, each with the provider's 240 s
timeout, and a fresh build plans four to six levels. Two of the seven
configurations were never useful in the recorded model benchmark, and a 400
rejection was retried through every intermediate configuration before the one
that works.

## Scope

### In scope

1. A shorter fallback ladder, justified by the benchmark recorded in
   `benchmarks/llm-coach/runs/`.
2. A cap on the attempts and the wall-clock time of one completion.
3. One shared budget for a whole plan level, covering the fallback chain and
   both JSON repair turns.
4. Immediate failure for errors that a retry cannot fix.
5. Tests for the ladder, the attempt cap, the time cap, and the non-retryable
   errors.

### Out of scope

- Provider request timeouts (`openrouter.ts` keeps its 240 s per request).
- The number of plan levels in a build, or the plan-update prompts.
- Retrying across models: the athlete's selected model stays the only model
  tried.

## Behaviour

### The fallback ladder

`completeWithFallbacks` tries at most four configurations, in this order:

| #   | Budget                     | Reasoning control | Why it is kept                                                                                                                                                                                             |
| --- | -------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | requested                  | `minimal`         | The normal path: 194 of the recorded completions succeeded.                                                                                                                                                |
| 2   | requested                  | `none`            | 48 recorded successes after a truncation; keeps reasoning out of the budget without spending more.                                                                                                         |
| 3   | doubled (capped at 32,768) | none              | 6 recorded successes, including models that require reasoning to be enabled.                                                                                                                               |
| 4   | 4,096                      | none              | A bounded rescue for a model that rejects the requested budget with a 400. Not reached by any recorded benchmark call, so it is the only configuration kept speculatively; it is cheap because it is last. |

The doubled budget is capped by `MAX_COMPLETION_TOKENS` (32,768), so attempt 3
never asks for more than any supported model can serve.

Dropped configurations and their evidence:

- **doubled budget with `reasoning: none`** — 7 attempts, 7 errors (every model
  that rejected `effort: none` also rejected it at the doubled budget), 0
  successes. Attempt 3 reaches the same response without that failure.
- **normal budget without reasoning control** — never used by a benchmark. It is
  dominated by attempt 2 (which also frees the reasoning tokens) and attempt 3
  (which has the larger budget).
- **4,096 with `reasoning: none`** — never used after a base budget of 16,384.
  Attempt 4 keeps the 4,096 rescue without the extra combination.

A 400 still advances to the next configuration, because a provider can reject a
reasoning control without rejecting the completion. With four attempts that
costs at most four billed calls instead of seven.

### Non-retryable errors

Only two failures are retried: a response that stopped at the output limit
(`LlmTokenLimitError`) and a 400 rejection. Everything else ends the call
immediately: an invalid key (401), insufficient credits (402), a forbidden or
unknown model (403, 404), an unprocessable request (422), a rate limit (429),
and transport failures. 429 is not retried because the fallback chain has no
backoff and an immediate retry would only spend the same quota again; the
athlete sees the rate-limit message that asks them to wait.

### Budgets

`planBudget.ts` owns the constants:

- `MAX_COMPLETION_ATTEMPTS = 4` — one completion's fallback ladder.
- `COMPLETION_BUDGET_MS = 300_000` — one completion's wall clock.
- `PLAN_LEVEL_MAX_COMPLETIONS = 6` — one plan level, shared by the initial
  response, its fallback chain, and both JSON repair turns. A normal level bills
  one to three completions; a pathological one stops at six.

`resilientCompletion.ts` enforces them through a `CompletionBudget`: the attempt
counter is decremented before every request, an attempt is not started when no
attempt or no time remains, and a request that outlives the deadline is
aborted. An exhausted budget fails with an `LlmProviderError` whose message
names the problem and keeps the last provider error as its cause, so the
athlete sees an actionable sentence either in the plan status or in the food or
reply error.

`completePlanJson` creates one budget per call (one plan level), so a JSON
repair turn can never restart the fallback chain with a fresh allowance. The
standalone callers of `completeWithFallbacks` (activity analysis, coach replies,
period reviews, food analysis) get one budget per completion.

A request aborted by the deadline is logged by `withPromptLogging` as a
cancelled attempt, because the provider only sees an aborted request. The plan
generation itself fails with the budget message rather than a stale-run
message.

### Prompt log

`attempt` and `ofAttempts` keep their meaning: the configuration number within
one completion and how many configurations that completion could use. Because a
plan level shares one budget, the repair turns of a nearly exhausted level may
show fewer attempts than the ladder allows; `ofAttempts` reports the ladder, not
the shared remainder.

## Acceptance criteria

1. One completion never issues more than four provider attempts.
2. One plan level never issues more than six provider completions, including
   JSON repair turns.
3. No attempt starts after the wall-clock budget is spent, and an attempt that
   outlives it is aborted.
4. 401, 402, 403, 404, 422, 429 and transport failures stop after one attempt.
5. Truncation and 400 rejections still reach a working configuration.
6. The remaining four configurations and the three dropped ones are documented
   above with their benchmark evidence.
7. `attempt` and `ofAttempts` still appear in the prompt log for each attempt.
