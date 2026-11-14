import type { CoachPlan } from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import { calorieEstimateProblems } from "./calorieEstimates.js";
import { blockFor, weekFor } from "./periods.js";

/**
 * Guards against a model that returns a plan for the wrong date. Without this
 * the pending check would immediately ask for another generation and loop.
 * Every write path ends here, so the season's block boundaries are checked
 * here too.
 */
export function assertPlanValid(
  plan: CoachPlan,
  today: string,
  includeTomorrow: boolean,
): void {
  const calorieProblem = calorieEstimateProblems(plan)[0];
  if (calorieProblem !== undefined) {
    throw new Error(`${calorieProblem.message} Please regenerate the plan.`);
  }
  assertSeasonBlocksContiguous(plan.season, today);
  if (plan.today.date !== today) {
    throw new Error(
      "The coach returned today's session for the wrong date. Please regenerate the plan.",
    );
  }
  if (!plan.week.sessions.some((session) => session.date === today)) {
    throw new Error(
      "The coach returned a week that does not include today. Please regenerate the plan.",
    );
  }
  if (today < plan.block.startDate || today > plan.block.endDate) {
    throw new Error(
      "The coach returned a block that does not cover today. Please regenerate the plan.",
    );
  }
  if (today < plan.season.startDate || today > plan.season.endDate) {
    throw new Error(
      "The coach returned a season that does not cover today. Please regenerate the plan.",
    );
  }
  if (plan.nextWeek !== null) {
    if (plan.nextWeek.startDate !== startOfWeek(plan.nextWeek.startDate)) {
      throw new Error(
        "The coach returned a week that does not start on a Monday. Please regenerate the plan.",
      );
    }
    if (plan.nextWeek.sessions[0]?.date !== plan.nextWeek.startDate) {
      throw new Error(
        "The coach returned a week whose sessions do not match its start date. Please regenerate the plan.",
      );
    }
    if (plan.nextWeek.startDate <= plan.week.startDate) {
      throw new Error(
        "The coach returned a next week that is not after the current week. Please regenerate the plan.",
      );
    }
    if (
      includeTomorrow &&
      plan.nextWeek.startDate !== startOfWeek(addDays(today, 1))
    ) {
      throw new Error(
        "The coach returned the wrong next week. Please regenerate the plan.",
      );
    }
  }
  if (plan.nextBlock !== null) {
    if (plan.nextBlock.startDate <= plan.block.endDate) {
      throw new Error(
        "The coach returned a next block that does not follow the current block. Please regenerate the plan.",
      );
    }
    if (plan.nextBlock.startDate > plan.nextBlock.endDate) {
      throw new Error(
        "The coach returned a next block with invalid dates. Please regenerate the plan.",
      );
    }
  }
  if (plan.tomorrow !== null) {
    const tomorrowDate = addDays(today, 1);
    if (plan.tomorrow.date !== tomorrowDate) {
      throw new Error(
        "The coach returned tomorrow's session for the wrong date. Please regenerate the plan.",
      );
    }
    const week = weekFor(plan, tomorrowDate);
    if (
      week === null ||
      !week.sessions.some((session) => session.date === tomorrowDate)
    ) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned week. Please regenerate the plan.",
      );
    }
    if (blockFor(plan, tomorrowDate) === null) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned block. Please regenerate the plan.",
      );
    }
  }
}

/**
 * Season blocks tile the season: each block starts the day after the previous
 * one ends. A shared day puts a date in two blocks and a skipped day leaves it
 * in none, so both are rejected on every write — a build, a season refresh and
 * a block, week or day update that returns the season alike. Without this a
 * week or block update could store overlapping blocks that every later season
 * refresh then reproduced. Blocks that ended before today are stored history
 * the coach cannot change, so their boundaries are not re-checked.
 */
function assertSeasonBlocksContiguous(
  season: CoachPlan["season"],
  today: string,
): void {
  const upcoming = season.blocks.filter((entry) => entry.endDate >= today);
  for (let index = 1; index < upcoming.length; index += 1) {
    const previous = upcoming[index - 1];
    const next = upcoming[index];
    if (previous === undefined || next === undefined) {
      continue;
    }
    if (next.startDate <= previous.endDate) {
      throw new Error(
        `The coach returned overlapping season blocks: "${next.name}" starts on ${next.startDate}, the day "${previous.name}" ends. Please regenerate the plan.`,
      );
    }
    const unplanned = addDays(previous.endDate, 1);
    if (next.startDate !== unplanned) {
      throw new Error(
        `The coach returned a gap between season blocks: "${previous.name}" ends on ${previous.endDate} and "${next.name}" starts on ${next.startDate}, leaving ${unplanned} unplanned. Please regenerate the plan.`,
      );
    }
  }
}
