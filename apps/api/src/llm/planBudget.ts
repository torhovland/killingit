/**
 * Output budget for one plan completion.
 *
 * The four plan prompts ask for a whole season, block, week or day as JSON.
 * Reasoning tokens count against `max_tokens`, so a budget that only fits the
 * visible JSON truncates reasoning models before they write anything useful.
 * 16,384 leaves room for the model's thinking plus the largest JSON response
 * (the week and day prompts) while keeping normal, non-reasoning responses
 * cheap: `max_tokens` is a ceiling, not a charge.
 *
 * `completeWithFallbacks` retries with reasoning disabled, then with a doubled
 * budget and no reasoning control (see `MAX_COMPLETION_TOKENS` and
 * `MAX_COMPLETION_ATTEMPTS`), so a model with a smaller output cap still has a
 * route to a smaller response.
 */
export const PLAN_MAX_TOKENS = 16_384;

/**
 * Hard ceiling for any completion fallback. Larger budgets let reasoning-heavy
 * models finish, but cap the spend and avoid asking providers for an output
 * size none of the supported models can serve.
 */
export const MAX_COMPLETION_TOKENS = 32_768;

/**
 * Provider attempts allowed for one completion, including every fallback.
 *
 * The ladder keeps only the configurations the recorded model benchmark has
 * needed: the requested budget with minimal reasoning, the same budget with
 * reasoning disabled, and the doubled budget without reasoning control. A
 * fourth, small-budget rescue covers a provider that rejects the requested
 * budget outright. See `docs/specs/llm-completion-budget.md`.
 */
export const MAX_COMPLETION_ATTEMPTS = 4;

/**
 * Wall-clock budget for one coach call, covering every fallback attempt and
 * JSON repair turn. A provider request alone may take 240 s, so this allows one
 * slow attempt plus a short retry and stops a model that keeps timing out from
 * holding a plan build open for tens of minutes.
 */
export const COMPLETION_BUDGET_MS = 300_000;

/**
 * Billed completions allowed for one plan level, shared by the initial
 * response, its fallback chain and both JSON repair turns. A normal level bills
 * one to three; a pathological one stops here instead of billing about 21.
 */
export const PLAN_LEVEL_MAX_COMPLETIONS = 6;

/**
 * The small output budget used to rescue a provider that rejects the requested
 * budget with a 400. It is the last attempt, so it costs nothing unless every
 * larger configuration was rejected.
 */
export const RESCUE_COMPLETION_TOKENS = 4_096;

/**
 * Output budget for a short coach analysis.
 *
 * `max_tokens` is a ceiling, not a charge, so a generous budget costs nothing
 * when the model stops early. It leaves room for reasoning tokens, which count
 * against the budget, so a reasoning model can finish in one attempt instead
 * of exhausting a small budget and forcing the fallback chain to repeat the
 * same review.
 */
export const ANALYSIS_MAX_TOKENS = 16_384;
