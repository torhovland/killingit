import type {
  BlockPlan,
  CoachPlan,
  PlanChangeScope,
  PlanPending,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import type { PlanUpdateResponse } from "../llm/planResult.js";
import type { PlanUpdateRevision } from "../llm/planUpdatePrompt.js";
import { weekFor } from "./periods.js";
import { PlanValidationError } from "./planValidationError.js";

/**
 * Which plan levels a single update completion revises, plus the two decisions
 * only the merge needs. The prompt receives the shared levels as a
 * `PlanUpdateRevision`.
 */
export type PlanUpdateFlags = PlanUpdateRevision & {
  /** A full week or block revision makes the stored next period stale. */
  clearNextPeriod: boolean;
  /** Revise the current block in place instead of starting the next one. */
  blockInPlace: boolean;
};

/** The part of a run's revision decision that chooses the levels to revise. */
export interface RevisionChoice {
  /** A refresh revises the stored season in place; an advance only fills gaps. */
  kind: "refresh" | "advance";
  /** New coaching input, activities or a week review must reach the plan. */
  revisionNeeded: boolean;
  /** A week review arrived after the stored plan was saved. */
  weekReviewPending: boolean;
  /**
   * The highest level the newest unseen input changes, widened across every
   * unseen input. Absent means the pre-scope behaviour: revise the week and
   * today. See `docs/specs/plan-refresh-judgement.md`.
   */
  refreshScope?: PlanChangeScope | undefined;
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
  /** A comment or manual entry about today refreshes today's session too. */
  keepToday?: boolean | undefined;
}

/**
 * The scope a revision uses. A scope the decision did not set falls back to the
 * pre-scope behaviour: any new input revised the week and today.
 */
function revisionScope(decision: RevisionChoice): PlanChangeScope {
  return decision.refreshScope ?? (decision.revisionNeeded ? "day" : "none");
}

/** True when the input revises the current block in place. */
function blockInPlaceFor(
  current: CoachPlan,
  today: string,
  decision: RevisionChoice,
  scope: PlanChangeScope,
  seasonRefresh: boolean,
): boolean {
  if (seasonRefresh) {
    return false;
  }
  // A direct caller with only the week-review flag keeps the old block-in-place
  // behaviour; a real decision supplies the scope.
  const blockScope =
    scope === "block" || (scope === "none" && decision.weekReviewPending);
  if (!blockScope) {
    return false;
  }
  return today >= current.block.startDate && today <= current.block.endDate;
}

/** True when today's session and the week around it are revised. */
function dayRevisionFor(
  seasonRefresh: boolean,
  blockRevision: boolean,
  pending: PlanPending,
  scope: PlanChangeScope,
  keepToday: boolean,
): boolean {
  return (
    seasonRefresh ||
    blockRevision ||
    pending.week ||
    pending.day ||
    keepToday ||
    scope === "day"
  );
}

/** True when the remaining week is revised, with or without today. */
function weekRevisionFor(
  dayRevision: boolean,
  pending: PlanPending,
  nextBlockSameWeek: boolean,
  scope: PlanChangeScope,
): boolean {
  return dayRevision || pending.week || nextBlockSameWeek || scope === "week";
}

/**
 * Works out which levels one plan update revises. The stored plan supplies the
 * week tomorrow falls in; `today` comes from the run because the stored day can
 * be stale. See `docs/specs/plan-revision-steps.md`.
 */
export function revisionFlags(input: RevisionFlagsInput): PlanUpdateFlags {
  const { current, pending, decision } = input;
  const { includeTomorrow, today, keepToday } = input;
  const refreshScope = revisionScope(decision);
  // A season scope is a refresh even when a caller builds the flags from an
  // advance decision.
  const seasonRefresh =
    decision.kind === "refresh" || refreshScope === "season";
  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = weekFor(current, tomorrowDate);
  const blockInPlace = blockInPlaceFor(
    current,
    today,
    decision,
    refreshScope,
    seasonRefresh,
  );
  const blockScope =
    refreshScope === "block" ||
    (refreshScope === "none" && decision.weekReviewPending);
  const blockRevision = seasonRefresh || pending.block || blockScope;
  const nextBlockRevision =
    includeTomorrow && pending.nextBlock && (seasonRefresh || !blockRevision);
  const nextBlockSameWeek =
    nextBlockRevision &&
    tomorrowWeek !== null &&
    tomorrowWeek.startDate === current.week.startDate;
  // A day scope revises today's session and the rest of the week around it. A
  // week scope revises the remaining week but keeps today's stored session. A
  // next-block transition that lands in the current week revises the week but
  // deliberately keeps today's session.
  const dayRevision = dayRevisionFor(
    seasonRefresh,
    blockRevision,
    pending,
    refreshScope,
    keepToday === true,
  );
  const weekRevision = weekRevisionFor(
    dayRevision,
    pending,
    nextBlockSameWeek,
    refreshScope,
  );
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
 * The prompt-level revision a plan update asks for: every level the prompt
 * shares with the merge, without the two decisions only the merge makes.
 */
export function planUpdateRevision(flags: PlanUpdateFlags): PlanUpdateRevision {
  const { clearNextPeriod, blockInPlace, ...revision } = flags;
  // Both are merge-only decisions; the prompt must never see them.
  return revision;
}

/**
 * Revises the week and day levels the update returned. A day revision takes the
 * returned today; a week-only revision keeps the stored session for today, which
 * a later step restores inside the returned week.
 */
export function mergeWeekAndDay(
  current: CoachPlan,
  update: PlanUpdateResponse,
  flags: PlanUpdateFlags,
): CoachPlan {
  if (flags.day) {
    return {
      ...current,
      week: update.week ?? current.week,
      today: update.today ?? current.today,
    };
  }
  if (flags.week) {
    return {
      ...current,
      week: update.week ?? current.week,
      today: current.today,
    };
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
  update: PlanUpdateResponse,
  flags: PlanUpdateFlags,
  today: string,
): CoachPlan {
  if (flags.season) {
    const season =
      update.season === undefined
        ? current.season
        : withStoredIntroduction(
            withCompletedSeasonBlocks(update.season, current.season, today),
            current.season,
          );
    const block = update.block ?? current.block;
    if (update.season !== undefined && update.block !== undefined) {
      assertRefreshedSeason(season, block, today, current.block);
    }
    return { ...current, season, block };
  }
  if (flags.block) {
    return {
      ...current,
      season:
        update.season === undefined
          ? current.season
          : withStoredIntroduction(update.season, current.season),
      block: update.block ?? current.block,
    };
  }
  if (flags.nextBlock) {
    return {
      ...current,
      season:
        update.season === undefined
          ? current.season
          : withStoredIntroduction(update.season, current.season),
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
  update: PlanUpdateResponse,
  flags: PlanUpdateFlags,
): CoachPlan {
  let plan = current;
  if (flags.clearNextPeriod && !flags.nextBlock) {
    plan = { ...plan, nextBlock: null };
  }
  if (flags.clearNextPeriod && !flags.nextWeek) {
    plan = { ...plan, nextWeek: null };
  }
  if (flags.nextBlock && update.nextBlock !== undefined) {
    plan = { ...plan, nextBlock: update.nextBlock };
  }
  if (flags.nextWeek && update.nextWeek !== undefined) {
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
  update: PlanUpdateResponse,
  flags: PlanUpdateFlags,
  today: string,
): CoachPlan {
  let plan = current;
  if (flags.clearNextPeriod && !flags.tomorrow) {
    plan = { ...plan, tomorrow: null };
  }
  if (flags.tomorrow && update.tomorrow !== undefined) {
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
    throw new PlanValidationError(
      "The coach returned tomorrow's session outside a planned week.",
    );
  }
  if (week.startDate === plan.week.startDate) {
    return {
      ...plan,
      week: withOutlineSession(
        plan.week,
        update.week ?? plan.week,
        plan.tomorrow.date,
      ),
    };
  }
  const source = update.nextWeek;
  if (source == null) {
    // A run that does not want tomorrow does not revise the next week either,
    // and may return no next week even though one is stored. The stored week
    // already holds tomorrow's session, so keep it instead of dropping a level
    // this run did not ask the coach to change.
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
  currentBlock: BlockPlan,
): void {
  const remaining = season.blocks.filter((entry) => entry.endDate >= today);
  const first = remaining[0];
  if (currentBlock.endDate >= today) {
    // The stored block is still in progress, so a refresh has to keep its
    // original start date rather than replacing it with one starting today.
    if (first === undefined || first.startDate !== currentBlock.startDate) {
      throw new PlanValidationError(
        "The coach returned a season refresh that moved the current block's start date.",
      );
    }
  } else if (
    first === undefined ||
    first.startDate > today ||
    first.endDate < today
  ) {
    // The stored block ended before today. The refresh may start a new block,
    // but it must cover today rather than leaving the current day unplanned.
    throw new PlanValidationError(
      "The coach returned a season refresh that does not cover today with a current block.",
    );
  }
  const last = remaining[remaining.length - 1];
  if (last !== undefined && last.endDate !== season.endDate) {
    throw new PlanValidationError(
      "The coach returned a season refresh that does not cover the rest of the season.",
    );
  }
  if (block.startDate !== first.startDate || block.endDate !== first.endDate) {
    throw new PlanValidationError(
      "The coach returned a block refresh that does not match the remaining season.",
    );
  }
}
