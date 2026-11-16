import { DEFAULT_DIET_GOAL, type DietPlan } from "@killingit/shared";

/**
 * True when a goal is the default maintenance fallback rather than a goal the
 * athlete stated. Old plans do not carry `goalProvided`, so an exact default
 * wording identifies them; trailing punctuation is ignored.
 *
 * This reads stored plan data rather than validating the wire, so it lives with
 * the API's diet code; `DEFAULT_DIET_GOAL` itself stays in the shared package,
 * where the plan contract and the web app read it. See ADR 0055.
 */
function isDefaultDietGoal(goal: string | null | undefined): boolean {
  if (goal === null || goal === undefined) {
    return true;
  }
  const normalised = goal
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return normalised === DEFAULT_DIET_GOAL.toLowerCase();
}

/**
 * Whether the athlete stated the diet goal themselves, as three states:
 * `true` when they did, `false` when the coach fell back to the default, and
 * `undefined` when no diet goal is stored at all. The stored `goalProvided` flag
 * wins; plans stored before it existed fall back to the default wording. Callers
 * that need a plain boolean decide how to read `undefined` themselves, so the
 * "no goal" case cannot be mistaken for "the athlete stated the default".
 */
export function isDietGoalProvided(
  diet: DietPlan | null | undefined,
): boolean | undefined {
  if (diet == null) {
    return undefined;
  }
  return diet.goalProvided ?? !isDefaultDietGoal(diet.goal);
}
