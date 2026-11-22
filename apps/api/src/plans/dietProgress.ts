import type {
  BlockPlan,
  CoachPlan,
  DietProgress,
  FitnessDietTarget,
  WeekPlan,
} from "@killingit/shared";
import type { PlanUpdateResponse } from "../llm/planResult.js";
import { isDietGoalProvided } from "../diet/goal.js";
import { planDietTargets } from "../training/dietTargets.js";
import { weekEnd } from "./periods.js";

/** How far a target may miss a stated goal and still count as reaching it. */
const GOAL_TOLERANCE = 0.5;

/** The plan levels whose diet-progress targets a check covers. */
export interface DietProgressLevelSelection {
  season: boolean;
  block: boolean;
  week: boolean;
  nextWeek: boolean;
  nextBlock: boolean;
}

const ALL_DIET_PROGRESS_LEVELS: DietProgressLevelSelection = {
  season: true,
  block: true,
  week: true,
  nextWeek: true,
  nextBlock: true,
};

/**
 * True when the target at the athlete's goal date does not reach a stated
 * numeric goal. The goal date may be mid-season; the first week or block end on
 * or after it is the checkpoint, and the season-end target may legitimately be
 * above a mid-season goal when a later build or race justifies that. A goal
 * date after the season ends is not due this season, and an explicit
 * `goalMissReason` accepts a deliberate miss.
 */
export function dietGoalProblems(plan: CoachPlan, today: string): string[] {
  const diet = plan.diet;
  if (diet == null) {
    return [];
  }
  if (diet.goalMissReason != null && diet.goalMissReason.trim() !== "") {
    return [];
  }
  if (diet.goalDate != null && diet.goalDate > plan.season.endDate) {
    return [];
  }
  const goalDate = diet.goalDate ?? plan.season.endDate;
  const checkpoint = goalCheckpoint(plan, today, goalDate);
  const goalBodyFatPercent = diet.goalBodyFatPercent ?? null;
  const checkpointDate = checkpoint?.date ?? goalDate;
  const checks: GoalCheck[] = [
    {
      goal: goalBodyFatPercent,
      target: checkpoint?.bodyFatPercent ?? null,
      missing: "body-fat",
      unit: "% body fat",
    },
    {
      goal: diet.goalWeightKg ?? null,
      target: checkpoint?.weightKg ?? null,
      missing: "weight",
      unit: "kg",
    },
  ];
  return checks
    .map((check) => goalProblem(check, goalDate, checkpointDate))
    .filter((problem): problem is string => problem !== null);
}

/** One stated numeric goal and the target that must reach it. */
type GoalCheck = {
  /** The stated goal, or null when the athlete stated none for this measure. */
  goal: number | null;
  /** The target at the goal checkpoint, or null when the plan has none. */
  target: number | null;
  /** The measure as named when its target is missing, such as "body-fat". */
  missing: string;
  /** The unit after a value, such as "% body fat" or "kg". */
  unit: string;
};

/**
 * The problem when the target at one checkpoint does not reach a stated numeric
 * goal, or null when it does or the athlete stated no goal for that measure.
 */
function goalProblem(
  check: GoalCheck,
  goalDate: string,
  checkpointDate: string,
): string | null {
  const { goal, target, missing, unit } = check;
  if (goal === null || (target !== null && target <= goal + GOAL_TOLERANCE)) {
    return null;
  }
  return `The target at ${checkpointDate} ${
    target === null ? `has no ${missing} target` : `is ${target} ${unit}`
  }, so it does not reach the athlete's goal of ${goal} ${unit} by ${goalDate}. Plan the target at that date to reach the goal, or set "diet.goalMissReason" with the specific conflict.`;
}

/** The first progress target on or after the goal date. */
function goalCheckpoint(
  plan: CoachPlan,
  today: string,
  goalDate: string,
): FitnessDietTarget | null {
  const targets = planDietTargets(plan, today).filter(
    (target) => target.date >= goalDate,
  );
  return targets[0] ?? null;
}

/**
 * The last season block ends on the season's last day, and the last week of
 * each detailed block ends on the block's last day, so each pair is the same
 * target. A disagreement means two views would show different destinations for
 * the same day.
 */
export function dietProgressConsistencyProblems(
  plan: CoachPlan,
  levels: DietProgressLevelSelection = ALL_DIET_PROGRESS_LEVELS,
): string[] {
  const problems: string[] = [];
  const lastBlock = plan.season.blocks[plan.season.blocks.length - 1];
  if (
    levels.season &&
    lastBlock !== undefined &&
    lastBlock.endDate === plan.season.endDate &&
    lastBlock.dietProgress != null &&
    plan.season.dietProgress != null
  ) {
    problems.push(
      ...targetMismatchProblems(
        "last block",
        lastBlock.dietProgress,
        "season end",
        plan.season.dietProgress,
      ),
    );
  }
  if (levels.block) {
    problems.push(...blockWeekProblems(plan.block));
  }
  if (levels.nextBlock && plan.nextBlock !== null) {
    problems.push(...blockWeekProblems(plan.nextBlock));
  }
  return problems;
}

/** The last week ends on the block's last day, so its target must match. */
function blockWeekProblems(block: BlockPlan): string[] {
  const lastWeek = block.weeks[block.weeks.length - 1];
  if (
    lastWeek === undefined ||
    weekEnd(lastWeek) !== block.endDate ||
    lastWeek.dietProgress == null ||
    block.dietProgress == null
  ) {
    return [];
  }
  return targetMismatchProblems(
    "last week",
    lastWeek.dietProgress,
    "block end",
    block.dietProgress,
  );
}

function targetMismatchProblems(
  firstName: string,
  first: { targetWeightKg: number | null; targetBodyFatPercent: number | null },
  secondName: string,
  second: {
    targetWeightKg: number | null;
    targetBodyFatPercent: number | null;
  },
): string[] {
  const problems: string[] = [];
  if (
    first.targetWeightKg !== null &&
    second.targetWeightKg !== null &&
    Math.abs(first.targetWeightKg - second.targetWeightKg) > GOAL_TOLERANCE
  ) {
    problems.push(
      `The ${firstName} target (${first.targetWeightKg} kg) does not match the ${secondName} target (${second.targetWeightKg} kg). They are the same day, so use one target.`,
    );
  }
  if (
    first.targetBodyFatPercent !== null &&
    second.targetBodyFatPercent !== null &&
    Math.abs(first.targetBodyFatPercent - second.targetBodyFatPercent) >
      GOAL_TOLERANCE
  ) {
    problems.push(
      `The ${firstName} target (${first.targetBodyFatPercent} % body fat) does not match the ${secondName} target (${second.targetBodyFatPercent} % body fat). They are the same day, so use one target.`,
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
  levels: DietProgressLevelSelection = ALL_DIET_PROGRESS_LEVELS,
): string[] {
  const missing: string[] = [];
  if (levels.season) {
    if (plan.season.endDate >= today && plan.season.dietProgress == null) {
      missing.push("the season");
    }
    for (const block of plan.season.blocks) {
      if (block.endDate >= today && block.dietProgress == null) {
        missing.push(`season block "${block.name}"`);
      }
    }
  }
  if (levels.block) {
    if (plan.block.endDate >= today && plan.block.dietProgress == null) {
      missing.push("the current block");
    }
    for (const week of plan.block.weeks) {
      if (weekEnd(week) >= today && week.dietProgress == null) {
        missing.push(`block week ${week.number}`);
      }
    }
  }
  if (levels.week && plan.week.dietProgress == null) {
    missing.push("the current week");
  }
  if (
    levels.nextWeek &&
    plan.nextWeek !== null &&
    plan.nextWeek.dietProgress == null
  ) {
    missing.push("the next week");
  }
  if (levels.nextBlock && plan.nextBlock !== null) {
    if (plan.nextBlock.dietProgress == null) {
      missing.push("the next block");
    }
    for (const week of plan.nextBlock.weeks) {
      if (weekEnd(week) >= today && week.dietProgress == null) {
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
  const goalProvided = isDietGoalProvided(plan.diet);
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
    dietGoalProblems(plan, today).length > 0 ||
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
  update: PlanUpdateResponse,
): CoachPlan {
  const season =
    update.season === undefined
      ? plan.season
      : {
          ...plan.season,
          dietProgress:
            update.season.dietProgress === undefined
              ? plan.season.dietProgress
              : update.season.dietProgress,
          blocks: withDetailedProgress(
            plan.season.blocks,
            update.season.blocks,
          ),
        };
  const block =
    update.block === undefined
      ? plan.block
      : mergeBlockProgress(plan.block, update.block);
  const week =
    update.week === undefined
      ? plan.week
      : mergeWeekProgress(plan.week, update.week);
  const nextBlock =
    plan.nextBlock === null ||
    update.nextBlock === undefined ||
    update.nextBlock === null
      ? plan.nextBlock
      : mergeBlockProgress(plan.nextBlock, update.nextBlock);
  const nextWeek =
    plan.nextWeek === null ||
    update.nextWeek === undefined ||
    update.nextWeek === null
      ? plan.nextWeek
      : mergeWeekProgress(plan.nextWeek, update.nextWeek);
  return {
    ...plan,
    season,
    block,
    week,
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
    dietProgress:
      update.dietProgress === undefined
        ? block.dietProgress
        : update.dietProgress,
    weeks: withDetailedProgress(block.weeks, update.weeks),
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

  const blocks = withDetailedProgress(plan.season.blocks, detailedBlocks);

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
    weeks: withDetailedProgress(block.weeks, detailedWeeks),
  };
}

/** A plan level that carries an optional diet target, matched by start date. */
type DatedDietProgress = {
  startDate: string;
  dietProgress?: DietProgress | null | undefined;
};

/**
 * Copies each detailed level's `dietProgress` onto the summary that starts on
 * the same date. A summary with no detailed match, or whose match omits the
 * field, keeps its stored target.
 */
function withDetailedProgress<T extends DatedDietProgress>(
  summaries: readonly T[],
  detailed: readonly DatedDietProgress[],
): T[] {
  return summaries.map((summary) => {
    const match = detailed.find(
      (level) => level.startDate === summary.startDate,
    );
    return match?.dietProgress === undefined
      ? summary
      : { ...summary, dietProgress: match.dietProgress };
  });
}
