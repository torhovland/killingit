import {
  isDefaultDietGoal,
  type BlockPlan,
  type CoachPlan,
  type WeekPlan,
} from "@killingit/shared";
import { addDays } from "../plans/dates.js";

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
  return missingDietProgressTargets(plan, today).length > 0;
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
