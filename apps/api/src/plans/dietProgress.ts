import {
  isDefaultDietGoal,
  type BlockPlan,
  type CoachPlan,
  type DietPlan,
  type WeekPlan,
} from "@killingit/shared";
import { addDays } from "../plans/dates.js";

/** How far a season target may miss a stated goal and still count as reaching it. */
const GOAL_TOLERANCE = 0.5;

/**
 * True when the season target does not reach a numeric goal the athlete stated
 * by the season end. A goal with a date after the season end is not due yet, so
 * the season target only has to move toward it; the coach reports the expected
 * date in the note and assessment.
 */
export function dietGoalProblems(plan: {
  season: CoachPlan["season"];
  diet?: DietPlan | null | undefined;
}): string[] {
  const diet = plan.diet;
  if (diet == null) {
    return [];
  }
  if (diet.goalDate != null && diet.goalDate > plan.season.endDate) {
    return [];
  }
  const problems: string[] = [];
  const progress = plan.season.dietProgress;
  const goalBodyFatPercent =
    diet.goalBodyFatPercent ?? impliedGoalBodyFatPercent(diet.goal);
  if (goalBodyFatPercent !== null) {
    const target = progress?.targetBodyFatPercent ?? null;
    if (target === null || target > goalBodyFatPercent + GOAL_TOLERANCE) {
      problems.push(
        `The season target of ${target === null ? "no body-fat target" : `${target} % body fat`} does not reach the athlete's goal of ${goalBodyFatPercent} % body fat by ${plan.season.endDate}. Plan the block targets so the season target reaches the goal.`,
      );
    }
  }
  if (diet.goalWeightKg != null) {
    const target = progress?.targetWeightKg ?? null;
    if (target === null || target > diet.goalWeightKg + GOAL_TOLERANCE) {
      problems.push(
        `The season target of ${target === null ? "no weight target" : `${target} kg`} does not reach the athlete's goal of ${diet.goalWeightKg} kg by ${plan.season.endDate}. Plan the block targets so the season target reaches the goal.`,
      );
    }
  }
  return problems;
}

/**
 * A body-fat percentage in the goal text, used as a safety net for a plan stored
 * before the structured goal fields existed. The coach still records the value
 * in `diet.goalBodyFatPercent`; this only lets a legacy goal be checked so the
 * plan can refresh itself. Only a percentage next to "body fat" or "bf" counts.
 */
export function impliedGoalBodyFatPercent(goal: string): number | null {
  const patterns = [
    /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:body\s*fat|bf)\b/i,
    /\b(?:body\s*fat|bf)\s*(?:to|toward|of|at|around|about)?\s*(\d{1,2}(?:\.\d+)?)\s*%/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(goal);
    const raw = match?.[1];
    if (raw === undefined) {
      continue;
    }
    const value = Number(raw);
    if (value > 0 && value <= 75) {
      return value;
    }
  }
  return null;
}

/**
 * The last season block ends on the season's last day, so its target and the
 * season-end target are the same target. A disagreement means the Season view
 * and the Block view would show two different destinations for the same day.
 */
export function dietProgressConsistencyProblems(plan: CoachPlan): string[] {
  const lastBlock = plan.season.blocks[plan.season.blocks.length - 1];
  if (
    lastBlock === undefined ||
    lastBlock.endDate !== plan.season.endDate ||
    lastBlock.dietProgress == null ||
    plan.season.dietProgress == null
  ) {
    return [];
  }
  const problems: string[] = [];
  const seasonWeight = plan.season.dietProgress.targetWeightKg;
  const blockWeight = lastBlock.dietProgress.targetWeightKg;
  if (
    seasonWeight !== null &&
    blockWeight !== null &&
    Math.abs(seasonWeight - blockWeight) > GOAL_TOLERANCE
  ) {
    problems.push(
      `The last block target (${blockWeight} kg) does not match the season-end target (${seasonWeight} kg). They are the same day, so use one target.`,
    );
  }
  const seasonFat = plan.season.dietProgress.targetBodyFatPercent;
  const blockFat = lastBlock.dietProgress.targetBodyFatPercent;
  if (
    seasonFat !== null &&
    blockFat !== null &&
    Math.abs(seasonFat - blockFat) > GOAL_TOLERANCE
  ) {
    problems.push(
      `The last block target (${blockFat} % body fat) does not match the season-end target (${seasonFat} % body fat). They are the same day, so use one target.`,
    );
  }
  return problems;
}

/**
 * The current and future periods whose `dietProgress` target is missing. The
 * season's own target and every block that has not ended are required, along
 * with each unended block week, the current week, and the next week or block
 * when it exists. Completed periods are history and not required.
 */
export function missingDietProgressTargets(
  plan: CoachPlan,
  today: string,
): string[] {
  const missing: string[] = [];
  if (plan.season.endDate >= today && plan.season.dietProgress == null) {
    missing.push("the season");
  }
  for (const block of plan.season.blocks) {
    if (block.endDate >= today && block.dietProgress == null) {
      missing.push(`season block "${block.name}"`);
    }
  }
  if (plan.block.endDate >= today && plan.block.dietProgress == null) {
    missing.push("the current block");
  }
  for (const week of plan.block.weeks) {
    if (addDays(week.startDate, 6) >= today && week.dietProgress == null) {
      missing.push(`block week ${week.number}`);
    }
  }
  if (plan.week.dietProgress == null) {
    missing.push("the current week");
  }
  if (plan.nextWeek !== null && plan.nextWeek.dietProgress == null) {
    missing.push("the next week");
  }
  if (plan.nextBlock !== null) {
    if (plan.nextBlock.dietProgress == null) {
      missing.push("the next block");
    }
    for (const week of plan.nextBlock.weeks) {
      if (addDays(week.startDate, 6) >= today && week.dietProgress == null) {
        missing.push(`next block week ${week.number}`);
      }
    }
  }
  return missing;
}

/**
 * True when an update must refresh diet progress: diet advice is on, the
 * athlete stated a goal (or a partial target already exists), and a current or
 * future period is missing its target. A plan with no stored goal gets one
 * normal update first, so the coach can record whether a goal was stated.
 */
export function dietProgressPending(
  plan: CoachPlan | null,
  dietAdvice: boolean,
  today: string,
): boolean {
  if (plan === null || !dietAdvice) {
    return false;
  }
  const goalProvided =
    plan.diet == null
      ? undefined
      : (plan.diet.goalProvided ?? !isDefaultDietGoal(plan.diet.goal));
  if (goalProvided === false) {
    return false;
  }
  if (goalProvided === undefined && !hasAnyDietProgress(plan)) {
    // An older plan has no stored goal yet. Refresh once so the coach can
    // record whether the athlete stated one and fill the targets if they did.
    return true;
  }
  return (
    missingDietProgressTargets(plan, today).length > 0 ||
    dietGoalProblems(plan).length > 0 ||
    dietProgressConsistencyProblems(plan).length > 0
  );
}

/** True when any level already carries a target, even a partial plan. */
function hasAnyDietProgress(plan: CoachPlan): boolean {
  return [
    plan.season.dietProgress,
    plan.block.dietProgress,
    plan.week.dietProgress,
    plan.nextWeek?.dietProgress,
    plan.nextBlock?.dietProgress,
    ...plan.season.blocks.map((block) => block.dietProgress),
    ...plan.block.weeks.map((week) => week.dietProgress),
    ...(plan.nextBlock?.weeks.map((week) => week.dietProgress) ?? []),
  ].some((progress) => progress != null);
}

/**
 * Copies only the `dietProgress` fields from an update onto a stored plan. The
 * update prompt returns every level, but the API keeps the training content of
 * a level the revision did not name; this lets the coach refresh the targets
 * without replacing the sessions, dates, focus or rationale. An omitted field
 * leaves the stored target alone.
 */
export function mergeDietProgressTargets(
  plan: CoachPlan,
  update: CoachPlan,
): CoachPlan {
  const season = {
    ...plan.season,
    ...(update.season.dietProgress !== undefined
      ? { dietProgress: update.season.dietProgress }
      : {}),
    blocks: plan.season.blocks.map((summary) => {
      const detailed = update.season.blocks.find(
        (block) => block.startDate === summary.startDate,
      );
      return detailed?.dietProgress === undefined
        ? summary
        : { ...summary, dietProgress: detailed.dietProgress };
    }),
  };
  const nextBlock =
    plan.nextBlock === null || update.nextBlock === null
      ? plan.nextBlock
      : mergeBlockProgress(plan.nextBlock, update.nextBlock);
  const nextWeek =
    plan.nextWeek === null || update.nextWeek === null
      ? plan.nextWeek
      : mergeWeekProgress(plan.nextWeek, update.nextWeek);
  return {
    ...plan,
    season,
    block: mergeBlockProgress(plan.block, update.block),
    week: mergeWeekProgress(plan.week, update.week),
    nextWeek,
    nextBlock,
  };
}

function mergeBlockProgress(block: BlockPlan, update: BlockPlan): BlockPlan {
  if (block.startDate !== update.startDate) {
    return block;
  }
  return {
    ...block,
    ...(update.dietProgress !== undefined
      ? { dietProgress: update.dietProgress }
      : {}),
    weeks: block.weeks.map((summary) => {
      const detailed = update.weeks.find(
        (week) => week.startDate === summary.startDate,
      );
      return detailed?.dietProgress === undefined
        ? summary
        : { ...summary, dietProgress: detailed.dietProgress };
    }),
  };
}

function mergeWeekProgress(week: WeekPlan, update: WeekPlan): WeekPlan {
  if (
    week.startDate !== update.startDate ||
    update.dietProgress === undefined
  ) {
    return week;
  }
  return { ...week, dietProgress: update.dietProgress };
}

/**
 * Copies a coach-returned target from the level that was just planned to the
 * summary that shows the same period, so the Season, Block and Week tabs name
 * the same target. The detailed plan is the newer value; a summary is only
 * overwritten when the detailed level returned a target, so an omitted field
 * never clears a stored target. The app copies the coach's numbers; it never
 * calculates one.
 */
export function syncDietProgressTargets(plan: CoachPlan): CoachPlan {
  const detailedBlocks = [plan.block, plan.nextBlock].filter(
    (block): block is BlockPlan => block !== null,
  );
  const detailedWeeks = [plan.week, plan.nextWeek].filter(
    (week): week is WeekPlan => week !== null,
  );

  const blocks = plan.season.blocks.map((summary) => {
    const detailed = detailedBlocks.find(
      (block) => block.startDate === summary.startDate,
    );
    return detailed?.dietProgress === undefined
      ? summary
      : { ...summary, dietProgress: detailed.dietProgress };
  });

  // The last block ends on the season's last day, so its target is the
  // season-end target too. The detailed block is the newer plan.
  const lastBlock = blocks[blocks.length - 1];
  const season =
    lastBlock !== undefined &&
    lastBlock.endDate === plan.season.endDate &&
    lastBlock.dietProgress !== undefined
      ? { ...plan.season, blocks, dietProgress: lastBlock.dietProgress }
      : { ...plan.season, blocks };

  return {
    ...plan,
    season,
    block: syncBlockWeeks(plan.block, detailedWeeks),
    nextBlock:
      plan.nextBlock === null
        ? null
        : syncBlockWeeks(plan.nextBlock, detailedWeeks),
  };
}

function syncBlockWeeks(
  block: BlockPlan,
  detailedWeeks: readonly WeekPlan[],
): BlockPlan {
  return {
    ...block,
    weeks: block.weeks.map((summary) => {
      const detailed = detailedWeeks.find(
        (week) => week.startDate === summary.startDate,
      );
      return detailed?.dietProgress === undefined
        ? summary
        : { ...summary, dietProgress: detailed.dietProgress };
    }),
  };
}
