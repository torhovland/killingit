import type { BlockPlan, CoachPlan, WeekPlan } from "@killingit/shared";

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
