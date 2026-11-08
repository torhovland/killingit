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
 * `completeWithFallbacks` retries with reasoning disabled and a doubled budget
 * (see `MAX_COMPLETION_TOKENS`), so a model with a smaller output cap still has
 * a route to a smaller response.
 */
export const PLAN_MAX_TOKENS = 16_384;

/**
 * Hard ceiling for any completion fallback. Larger budgets let reasoning-heavy
 * models finish, but cap the spend and avoid asking providers for an output
 * size none of the supported models can serve.
 */
export const MAX_COMPLETION_TOKENS = 32_768;

/**
 * Output budget for a short coach analysis or program review.
 *
 * `max_tokens` is a ceiling, not a charge, so a generous budget costs nothing
 * when the model stops early. It leaves room for reasoning tokens, which count
 * against the budget, so a reasoning model can finish in one attempt instead
 * of exhausting a small budget and forcing the fallback chain to repeat the
 * same review.
 */
export const ANALYSIS_MAX_TOKENS = 16_384;
