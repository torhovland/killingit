import type {
  AthleteEvent,
  BlockPlan,
  BlockSubGoal,
  CoachPlan,
  SeasonGoal,
  SeasonPlan,
} from "@killingit/shared";

/** The context a goal-coverage check needs beyond the plan levels. */
export interface GoalCoverageInput {
  /** The day the plan is being planned for; completed blocks are history. */
  today: string;
  /** Dated athlete statements the season has to account for. */
  events?: readonly AthleteEvent[] | undefined;
}

/** The event kinds that are training goals rather than fixed commitments. */
const GOAL_EVENT_KINDS = new Set<AthleteEvent["kind"]>([
  "race",
  "goal",
  "event",
]);

/** Goals the plan has not passed yet, in the athlete's date order. */
function goalsAhead(season: SeasonPlan, today: string): SeasonGoal[] {
  return (season.goals ?? []).filter((goal) => goal.date >= today);
}

/** The dates of every upcoming athlete goal that the season must list. */
function requiredEventDates(
  events: readonly AthleteEvent[] | undefined,
  today: string,
): string[] {
  return [
    ...new Set(
      (events ?? [])
        .filter((event) => event.startDate >= today)
        .filter((event) => GOAL_EVENT_KINDS.has(event.kind))
        .map((event) => event.startDate),
    ),
  ];
}

function sameSubGoal(a: BlockSubGoal, b: BlockSubGoal): boolean {
  return (
    a.goalTitle === b.goalTitle &&
    a.goalDate === b.goalDate &&
    a.role === b.role &&
    a.target === b.target &&
    a.byDate === b.byDate
  );
}

function sameSubGoals(
  left: readonly BlockSubGoal[],
  right: readonly BlockSubGoal[],
): boolean {
  if (left.length !== right.length) return false;
  const remaining = [...right];
  for (const subGoal of left) {
    const index = remaining.findIndex((entry) => sameSubGoal(entry, subGoal));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/** The goals a block has to account for because they are still ahead of it. */
function goalIsAheadOfBlock(
  goal: SeasonGoal,
  block: { startDate: string },
): boolean {
  return goal.date >= block.startDate;
}

/** The sub-goals that name `goal` by its exact title and date. */
function subGoalsFor(
  subGoals: readonly BlockSubGoal[],
  goal: SeasonGoal,
): BlockSubGoal[] {
  return subGoals.filter(
    (subGoal) =>
      subGoal.goalTitle === goal.title && subGoal.goalDate === goal.date,
  );
}

/**
 * Checks one block's ledger: every future goal is accounted for, every
 * sub-goal points at a season goal and lands inside the block, and the detailed
 * block matches its season summary when that summary carries sub-goals.
 */
export function blockGoalProblems(
  block: BlockPlan,
  season: SeasonPlan,
  input: GoalCoverageInput,
): string[] {
  if (block.endDate < input.today) {
    return [];
  }
  if (block.subGoals === undefined) {
    return [
      `The block "${block.name}" must carry "subGoals" for every goal still ahead of it.`,
    ];
  }
  const goals = season.goals ?? [];
  const ahead = goalsAhead(season, input.today);
  const problems: string[] = [];
  for (const subGoal of block.subGoals) {
    const goal = goals.find(
      (entry) =>
        entry.title === subGoal.goalTitle && entry.date === subGoal.goalDate,
    );
    if (goal === undefined) {
      problems.push(
        `The block "${block.name}" has a sub-goal for "${subGoal.goalTitle}" on ${subGoal.goalDate}, which is not in the season's goals.`,
      );
    }
    if (subGoal.byDate < block.startDate || subGoal.byDate > block.endDate) {
      problems.push(
        `The block "${block.name}" has the sub-goal "${subGoal.target}" due on ${subGoal.byDate}, which is outside the block's dates.`,
      );
    }
  }
  for (const goal of ahead.filter((entry) =>
    goalIsAheadOfBlock(entry, block),
  )) {
    if (subGoalsFor(block.subGoals, goal).length === 0) {
      problems.push(
        `The block "${block.name}" does not account for the goal "${goal.title}" on ${goal.date}.`,
      );
    }
  }
  const summary = season.blocks.find(
    (entry) =>
      entry.startDate === block.startDate && entry.endDate === block.endDate,
  );
  if (
    summary?.subGoals !== undefined &&
    !sameSubGoals(summary.subGoals, block.subGoals)
  ) {
    problems.push(
      `The block "${block.name}" must use the same sub-goals as its season summary.`,
    );
  }
  return problems;
}

/**
 * Checks the season's goal ledger and every current or future block summary.
 * A plan saved before the ledger existed has no `goals`; it is left alone
 * unless the athlete's events now require a goal to be listed.
 */
export function seasonGoalProblems(
  season: SeasonPlan,
  input: GoalCoverageInput,
): string[] {
  const requiredDates = requiredEventDates(input.events, input.today);
  const goals = season.goals;
  if (goals === undefined) {
    return requiredDates.length === 0
      ? []
      : [
          `The season must list the athlete's dated goals in "goals": ${requiredDates.join(", ")}.`,
        ];
  }
  const problems: string[] = [];
  const listedDates = new Set(goals.map((goal) => goal.date));
  for (const date of requiredDates) {
    if (!listedDates.has(date)) {
      problems.push(
        `The season's "goals" does not include the athlete's goal on ${date}.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const goal of goals) {
    const key = `${goal.title}\u0000${goal.date}`;
    if (seen.has(key)) {
      problems.push(
        `The season lists the goal "${goal.title}" on ${goal.date} more than once.`,
      );
    }
    seen.add(key);
  }
  for (const block of season.blocks.filter(
    (entry) => entry.endDate >= input.today,
  )) {
    if (block.subGoals === undefined) {
      problems.push(
        `The season block "${block.name}" must carry "subGoals" for every goal still ahead of it.`,
      );
      continue;
    }
    for (const subGoal of block.subGoals) {
      if (
        !goals.some(
          (goal) =>
            goal.title === subGoal.goalTitle && goal.date === subGoal.goalDate,
        )
      ) {
        problems.push(
          `The season block "${block.name}" has a sub-goal for "${subGoal.goalTitle}" on ${subGoal.goalDate}, which is not in the season's goals.`,
        );
      }
      if (subGoal.byDate < block.startDate || subGoal.byDate > block.endDate) {
        problems.push(
          `The season block "${block.name}" has the sub-goal "${subGoal.target}" due on ${subGoal.byDate}, which is outside the block's dates.`,
        );
      }
    }
    for (const goal of goals.filter((entry) =>
      goalIsAheadOfBlock(entry, block),
    )) {
      if (subGoalsFor(block.subGoals, goal).length === 0) {
        problems.push(
          `The season block "${block.name}" does not account for the goal "${goal.title}" on ${goal.date}.`,
        );
      }
    }
  }
  return problems;
}

/**
 * Checks every level a plan response can return. `nextBlock` is often a block
 * the season summary already carries; it is checked like the current block.
 */
export function planGoalProblems(
  plan: Pick<CoachPlan, "season" | "block" | "nextBlock">,
  input: GoalCoverageInput,
): string[] {
  const problems = seasonGoalProblems(plan.season, input);
  if (plan.season.goals === undefined) {
    return problems;
  }
  if (plan.block.endDate >= input.today) {
    problems.push(...blockGoalProblems(plan.block, plan.season, input));
  }
  if (plan.nextBlock !== null && plan.nextBlock.endDate >= input.today) {
    problems.push(...blockGoalProblems(plan.nextBlock, plan.season, input));
  }
  return problems;
}
