/**
 * Sampling temperatures for the coach's completions, named by the job the call
 * does. A lower temperature makes repeated answers agree more closely, so
 * writing keeps some variety while extraction and JSON repair stay the most
 * repeatable.
 *
 * The answer temperatures are deliberately higher than the plan temperature:
 * the same coaching point should reach the athlete in fresh wording each time,
 * while the plan JSON stays stable and valid.
 *
 * `completeWithFallbacks` has no default temperature: every caller names its
 * intent with one of these constants.
 */

/** Plans a season, block, week or day as JSON. */
export const PLAN_TEMPERATURE = 0.4;

/** Writes a short conversational reply to the athlete. */
export const COACH_REPLY_TEMPERATURE = 0.8;

/** Reads a completed activity or period back to the athlete. */
export const ANALYSIS_TEMPERATURE = 0.5;

/** Estimates a meal's macros from its photo or description. */
export const FOOD_ANALYSIS_TEMPERATURE = 0.2;

/** Rewrites a rejected plan response so it satisfies the JSON contract. */
export const REPAIR_TEMPERATURE = 0.2;
