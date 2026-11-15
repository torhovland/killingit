import type { LlmModelGrade } from "@killingit/shared";

/**
 * List-price grade limits for a model that has no benchmark yet. A model must
 * be at or below both the prompt and completion limit for a band. A+ and F are
 * fixed by product; the A-E cuts are calibrated so those five bands are roughly
 * equally populated across the measured catalog.
 */
const PRICE_GRADE_LIMITS = {
  aPlus: { prompt: 0.1, completion: 0.5 },
  a: { prompt: 0.32, completion: 1.6 },
  b: { prompt: 0.8, completion: 4 },
  c: { prompt: 2, completion: 10 },
  d: { prompt: 3, completion: 15 },
  e: { prompt: 20, completion: 100 },
} as const;

/**
 * Estimated benchmark cost for a model that has not been called yet. The
 * benchmark runs two prompts (the today plan and a season revision), so the
 * estimate covers both calls.
 */
export function estimateBenchmarkCost(
  promptPricePerMillion: number | null,
  completionPricePerMillion: number | null,
): number | null {
  if (promptPricePerMillion === null && completionPricePerMillion === null) {
    return null;
  }
  return (
    ((promptPricePerMillion ?? 0) * 32_000) / 1_000_000 +
    ((completionPricePerMillion ?? 0) * 2_400) / 1_000_000
  );
}

/** True when both price points are known and either one has moved. */
export function pricingChanged(
  previousPrompt: number | null,
  previousCompletion: number | null,
  nextPrompt: number | null,
  nextCompletion: number | null,
): boolean {
  // A null previous price means the column predates price tracking; it is not
  // a change. A null next price means the provider omitted pricing.
  if (previousPrompt === null && previousCompletion === null) return false;
  if (nextPrompt === null && nextCompletion === null) return false;
  const epsilon = 1e-9;
  const differs = (a: number | null, b: number | null) =>
    a === null || b === null ? a !== b : Math.abs(a - b) > epsilon;
  return (
    differs(previousPrompt, nextPrompt) ||
    differs(previousCompletion, nextCompletion)
  );
}

/** True when a known alias points at a different concrete model. */
export function aliasTargetChanged(
  previous: string | null,
  next: string | null,
): boolean {
  return previous !== null && next !== null && previous !== next;
}

/**
 * Grades a model by its current list price. Used until a model has a measured
 * benchmark cost; a routed model with no fixed price stays ungraded.
 */
export function priceGrade(
  promptPricePerMillion: number | null | undefined,
  completionPricePerMillion: number | null | undefined,
): LlmModelGrade {
  if (
    promptPricePerMillion === null ||
    promptPricePerMillion === undefined ||
    completionPricePerMillion === null ||
    completionPricePerMillion === undefined ||
    promptPricePerMillion < 0 ||
    completionPricePerMillion < 0
  ) {
    return "?";
  }
  const limits = PRICE_GRADE_LIMITS;
  if (
    promptPricePerMillion < limits.aPlus.prompt &&
    completionPricePerMillion < limits.aPlus.completion
  ) {
    return "A+";
  }
  if (
    promptPricePerMillion < limits.a.prompt &&
    completionPricePerMillion < limits.a.completion
  ) {
    return "A";
  }
  if (
    promptPricePerMillion < limits.b.prompt &&
    completionPricePerMillion < limits.b.completion
  ) {
    return "B";
  }
  if (
    promptPricePerMillion < limits.c.prompt &&
    completionPricePerMillion < limits.c.completion
  ) {
    return "C";
  }
  if (
    promptPricePerMillion < limits.d.prompt &&
    completionPricePerMillion < limits.d.completion
  ) {
    return "D";
  }
  if (
    promptPricePerMillion < limits.e.prompt &&
    completionPricePerMillion < limits.e.completion
  ) {
    return "E";
  }
  return "F";
}
