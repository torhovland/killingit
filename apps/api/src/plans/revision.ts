import type {
  BlockPlan,
  CoachPlan,
  PlanPending,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import { weekFor } from "./periods.js";

/** Which plan levels a single update completion revises. */
export interface PlanUpdateFlags {
  season: boolean;
  block: boolean;
  week: boolean;
  day: boolean;
  tomorrow: boolean;
  nextWeek: boolean;
  nextBlock: boolean;
  /** A full week or block revision makes the stored next period stale. */
  clearNextPeriod: boolean;
  /** Revise the current block in place instead of starting the next one. */
  blockInPlace: boolean;
  /** Refresh the diet progress targets on every level. */
  progress: boolean;
}

/** The part of a run's revision decision that chooses the levels to revise. */
export interface RevisionChoice {
  /** A refresh revises the stored season in place; an advance only fills gaps. */
  kind: "refresh" | "advance";
  /** New coaching input, activities or a week review must reach the plan. */
  revisionNeeded: boolean;
  /** A week review arrived after the stored plan was saved. */
  weekReviewPending: boolean;
}

export interface RevisionFlagsInput {
  /** The stored plan the run advances. */
  current: CoachPlan;
  /** The levels the stored plan is missing or must revise. */
  pending: PlanPending;
  /** How the run treats the stored season. */
  decision: RevisionChoice;
  /** The day the run is for. */
  today: string;
  /** The client is after 18:00, so tomorrow's session is wanted. */
  includeTomorrow: boolean;
}

/**
 * Works out which levels one plan update revises. The stored plan supplies the
 * week tomorrow falls in; `today` comes from the run because the stored day can
 * be stale. See `docs/specs/plan-revision-steps.md`.
 */
export function revisionFlags(input: RevisionFlagsInput): PlanUpdateFlags {
  const { current, pending, decision } = input;
  const { includeTomorrow, today } = input;
  const seasonRefresh = decision.kind === "refresh";
  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = weekFor(current, tomorrowDate);
  const blockInPlace =
    decision.weekReviewPending &&
    !seasonRefresh &&
    today >= current.block.startDate &&
    today <= current.block.endDate;
  const blockRevision =
    seasonRefresh || pending.block || decision.weekReviewPending;
  const nextBlockRevision =
    includeTomorrow && pending.nextBlock && (seasonRefresh || !blockRevision);
  const nextBlockSameWeek =
    nextBlockRevision &&
    tomorrowWeek !== null &&
    tomorrowWeek.startDate === current.week.startDate;
  // A new day revises today's session and the rest of the week around it. A
  // next-block transition that lands in the current week revises the week but
  // deliberately keeps today's session.
  const weekRevision =
    seasonRefresh ||
    blockRevision ||
    decision.revisionNeeded ||
    pending.week ||
    pending.day ||
    nextBlockSameWeek;
  const dayRevision =
    seasonRefresh ||
    blockRevision ||
    decision.revisionNeeded ||
    pending.week ||
    pending.day;
  const nextWeekRevision =
    includeTomorrow && startOfWeek(tomorrowDate) !== startOfWeek(today);
  const tomorrowRevision =
    includeTomorrow &&
    (pending.tomorrow ||
      weekRevision ||
      dayRevision ||
      nextBlockRevision ||
      nextWeekRevision);
  return {
    season: seasonRefresh,
    block: blockRevision,
    week: weekRevision,
    day: dayRevision,
    tomorrow: tomorrowRevision,
    nextWeek: nextWeekRevision,
    nextBlock: nextBlockRevision,
    clearNextPeriod:
      seasonRefresh ||
      blockRevision ||
      decision.revisionNeeded ||
      pending.week ||
      nextBlockRevision,
    blockInPlace,
    progress: true,
  };
}

/**
 * Revises the week and day levels the update returned. A day revision takes the
 * returned today; a week-only revision keeps the stored session for today, which
 * a later step restores inside the returned week.
 */
export function mergeWeekAndDay(
  current: CoachPlan,
  update: CoachPlan,
  flags: PlanUpdateFlags,
): CoachPlan {
  if (flags.day) {
    return { ...current, week: update.week, today: update.today };
  }
  if (flags.week) {
    return { ...current, week: update.week, today: current.today };
  }
  return current;
}

/**
 * Revises the season and block levels. A refresh restores the completed blocks
 * and the original season start, takes the returned block and rejects an answer
 * that moved the current block's start date. A block revision takes the returned
 * block; a next-block revision refreshes only the season summary. Every returned
 * season keeps the stored greeting when the coach omitted it.
 */
export function mergeSeasonAndBlock(
  current: CoachPlan,
  update: CoachPlan,
  flags: PlanUpdateFlags,
  today: string,
): CoachPlan {
  if (flags.season) {
    const season = withStoredIntroduction(
      withCompletedSeasonBlocks(update.season, current.season, today),
      current.season,
    );
    assertRefreshedSeason(season, update.block, today, current.block.startDate);
    return { ...current, season, block: update.block };
  }
  if (flags.block) {
    return {
      ...current,
      season: withStoredIntroduction(update.season, current.season),
      block: update.block,
    };
  }
  if (flags.nextBlock) {
    return {
      ...current,
      season: withStoredIntroduction(update.season, current.season),
    };
  }
  return current;
}

/**
 * Replaces or clears the stored next block and next week. A full revision makes
 * the stored next period stale unless this update returned it.
 */
export function mergeNextPeriod(
  current: CoachPlan,
  update: CoachPlan,
  flags: PlanUpdateFlags,
): CoachPlan {
  let plan = current;
  if (flags.clearNextPeriod && !flags.nextBlock) {
    plan = { ...plan, nextBlock: null };
  }
  if (flags.clearNextPeriod && !flags.nextWeek) {
    plan = { ...plan, nextWeek: null };
  }
  if (flags.nextBlock) {
    plan = { ...plan, nextBlock: update.nextBlock };
  }
  if (flags.nextWeek) {
    plan = { ...plan, nextWeek: update.nextWeek };
  }
  return plan;
}

/**
 * Stores or clears tomorrow, drops it when it is no longer the next day, and
 * copies tomorrow's outline from the returned week or next week. The next period
 * must have been merged already, because tomorrow's week may be the next one.
 */
export function mergeTomorrow(
  current: CoachPlan,
  update: CoachPlan,
  flags: PlanUpdateFlags,
  today: string,
): CoachPlan {
  let plan = current;
  if (flags.clearNextPeriod && !flags.tomorrow) {
    plan = { ...plan, tomorrow: null };
  }
  if (flags.tomorrow) {
    plan = { ...plan, tomorrow: update.tomorrow };
  }

  const tomorrowDate = addDays(today, 1);
  if (plan.tomorrow !== null && plan.tomorrow.date !== tomorrowDate) {
    plan = { ...plan, tomorrow: null };
  }
  if (plan.tomorrow === null) {
    return plan;
  }

  const week = weekFor(plan, plan.tomorrow.date);
  if (week === null) {
    throw new Error(
      "The coach returned tomorrow's session outside a planned week. Please regenerate the plan.",
    );
  }
  if (week.startDate === plan.week.startDate) {
    return {
      ...plan,
      week: withOutlineSession(plan.week, update.week, plan.tomorrow.date),
    };
  }
  const source = update.nextWeek;
  if (source === null) {
    return plan;
  }
  return {
    ...plan,
    nextWeek: withOutlineSession(
      plan.nextWeek ?? source,
      source,
      plan.tomorrow.date,
    ),
  };
}

/**
 * Replaces one dated week session with the coach's returned outline. The week
 * keeps its other sessions and its overview level; only the named day moves.
 */
function withOutlineSession(
  week: WeekPlan,
  source: WeekPlan,
  date: string,
): WeekPlan {
  const session = source.sessions.find((entry) => entry.date === date);
  if (session === undefined) {
    return week;
  }
  return {
    ...week,
    sessions: week.sessions.map((entry) =>
      entry.date === date ? session : entry,
    ),
  };
}

/**
 * Keeps the greeting from the season the coach first planned. A refresh or a
 * block update returns the season without needing to repeat the introduction,
 * and an omitted greeting must not make the coach introduce themselves again.
 */
function withStoredIntroduction(
  season: SeasonPlan,
  previous: SeasonPlan,
): SeasonPlan {
  return {
    ...season,
    introduction: season.introduction ?? previous.introduction ?? null,
  };
}

/**
 * Restores the season's history after a refresh. Completed blocks are the
 * stored ones, unchanged; everything from today onward comes from the coach's
 * refreshed season. The original start date keeps the history in one season.
 */
function withCompletedSeasonBlocks(
  generated: SeasonPlan,
  previous: SeasonPlan,
  today: string,
): SeasonPlan {
  const completed = previous.blocks.filter((entry) => entry.endDate < today);
  const remaining = generated.blocks.filter((entry) => entry.endDate >= today);
  return {
    ...generated,
    startDate: previous.startDate,
    blocks: [...completed, ...remaining],
  };
}

/**
 * A refreshed season must keep the current block in place while re-planning
 * from today. Without this check the model can replace a partially completed
 * block with one that starts today, losing the block's original start date.
 * Whether the refreshed blocks tile the season is checked for every write in
 * `assertSeasonBlocksContiguous`.
 */
function assertRefreshedSeason(
  season: SeasonPlan,
  block: BlockPlan,
  today: string,
  currentBlockStartDate: string,
): void {
  const remaining = season.blocks.filter((entry) => entry.endDate >= today);
  const first = remaining[0];
  if (first === undefined || first.startDate !== currentBlockStartDate) {
    throw new Error(
      "The coach returned a season refresh that moved the current block's start date. Please regenerate the plan.",
    );
  }
  const last = remaining[remaining.length - 1];
  if (last !== undefined && last.endDate !== season.endDate) {
    throw new Error(
      "The coach returned a season refresh that does not cover the rest of the season. Please regenerate the plan.",
    );
  }
  if (
    block.startDate !== currentBlockStartDate ||
    block.endDate !== first.endDate
  ) {
    throw new Error(
      "The coach returned a block refresh that does not match the remaining season. Please regenerate the plan.",
    );
  }
}
