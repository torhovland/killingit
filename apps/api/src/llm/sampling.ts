/**
 * Sampling temperatures for the coach's completions, named by the job the call
 * does. A lower temperature makes repeated answers agree more closely, so
 * writing keeps some variety while extraction and JSON repair stay the most
 * repeatable.
 *
 * `completeWithFallbacks` has no default temperature: every caller names its
 * intent with one of these constants.
 */

/** Plans a season, block, week or day as JSON. */
export const PLAN_TEMPERATURE = 0.4;

/** Writes a short conversational reply to the athlete. */
export const COACH_REPLY_TEMPERATURE = 0.4;

/** Reads a completed activity or period back to the athlete. */
export const ANALYSIS_TEMPERATURE = 0.3;

/** Estimates a meal's macros from its photo or description. */
export const FOOD_ANALYSIS_TEMPERATURE = 0.2;

/** Rewrites a rejected plan response so it satisfies the JSON contract. */
export const REPAIR_TEMPERATURE = 0.2;
