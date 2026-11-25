import type { CoachPlan } from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import { calorieEstimateProblems } from "./calorieEstimates.js";
import { planGoalProblems } from "./goals.js";
import { blockFor, weekFor } from "./periods.js";
import { PlanValidationError } from "./planValidationError.js";

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
    throw new PlanValidationError(calorieProblem.message);
  }
  assertSeasonBlocksContiguous(plan.season, today);
  const goalProblem = planGoalProblems(plan, { today })[0];
  if (goalProblem !== undefined) {
    throw new PlanValidationError(goalProblem);
  }
  if (plan.today.date !== today) {
    throw new PlanValidationError(
      "The coach returned today's session for the wrong date.",
    );
  }
  if (!plan.week.sessions.some((session) => session.date === today)) {
    throw new PlanValidationError(
      "The coach returned a week that does not include today.",
    );
  }
  if (today < plan.block.startDate || today > plan.block.endDate) {
    throw new PlanValidationError(
      "The coach returned a block that does not cover today.",
    );
  }
  if (today < plan.season.startDate || today > plan.season.endDate) {
    throw new PlanValidationError(
      "The coach returned a season that does not cover today.",
    );
  }
  if (plan.nextWeek !== null) {
    if (plan.nextWeek.startDate !== startOfWeek(plan.nextWeek.startDate)) {
      throw new PlanValidationError(
        "The coach returned a week that does not start on a Monday.",
      );
    }
    if (plan.nextWeek.sessions[0]?.date !== plan.nextWeek.startDate) {
      throw new PlanValidationError(
        "The coach returned a week whose sessions do not match its start date.",
      );
    }
    if (plan.nextWeek.startDate <= plan.week.startDate) {
      throw new PlanValidationError(
        "The coach returned a next week that is not after the current week.",
      );
    }
    if (
      includeTomorrow &&
      plan.nextWeek.startDate !== startOfWeek(addDays(today, 1))
    ) {
      throw new PlanValidationError("The coach returned the wrong next week.");
    }
  }
  if (plan.nextBlock !== null) {
    if (plan.nextBlock.startDate <= plan.block.endDate) {
      throw new PlanValidationError(
        "The coach returned a next block that does not follow the current block.",
      );
    }
    if (plan.nextBlock.startDate > plan.nextBlock.endDate) {
      throw new PlanValidationError(
        "The coach returned a next block with invalid dates.",
      );
    }
  }
  if (plan.tomorrow !== null) {
    const tomorrowDate = addDays(today, 1);
    if (plan.tomorrow.date !== tomorrowDate) {
      throw new PlanValidationError(
        "The coach returned tomorrow's session for the wrong date.",
      );
    }
    const week = weekFor(plan, tomorrowDate);
    if (
      week === null ||
      !week.sessions.some((session) => session.date === tomorrowDate)
    ) {
      throw new PlanValidationError(
        "The coach returned tomorrow's session outside a planned week.",
      );
    }
    if (blockFor(plan, tomorrowDate) === null) {
      throw new PlanValidationError(
        "The coach returned tomorrow's session outside a planned block.",
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
      throw new PlanValidationError(
        `The coach returned overlapping season blocks: "${next.name}" starts on ${next.startDate}, the day "${previous.name}" ends.`,
      );
    }
    const unplanned = addDays(previous.endDate, 1);
    if (next.startDate !== unplanned) {
      throw new PlanValidationError(
        `The coach returned a gap between season blocks: "${previous.name}" ends on ${previous.endDate} and "${next.name}" starts on ${next.startDate}, leaving ${unplanned} unplanned.`,
      );
    }
  }
}
