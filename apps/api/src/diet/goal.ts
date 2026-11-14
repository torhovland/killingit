import { DEFAULT_DIET_GOAL } from "@killingit/shared";

/**
 * True when a goal is the default maintenance fallback rather than a goal the
 * athlete stated. Old plans do not carry `goalProvided`, so an exact default
 * wording identifies them; trailing punctuation is ignored.
 *
 * This reads stored plan data rather than validating the wire, so it lives with
 * the API's diet code; `DEFAULT_DIET_GOAL` itself stays in the shared package,
 * where the plan contract and the web app read it. See ADR 0055.
 */
export function isDefaultDietGoal(goal: string | null | undefined): boolean {
  if (goal === null || goal === undefined) {
    return true;
  }
  const normalised = goal
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return normalised === DEFAULT_DIET_GOAL.toLowerCase();
}
