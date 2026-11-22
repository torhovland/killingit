/**
 * How the stored coaching inputs decide whether the plan needs a refresh, and
 * how far the refresh reaches.
 *
 * Every input carries the coach's plan change scope, taken from the reply the
 * coach wrote after reading it. A missing reply fails open: the input keeps
 * refreshing the plan, at the widest scope, so a failed reply can never
 * silently drop a change.
 */

import type { PlanChangeScope } from "@killingit/shared";
import { isNewer } from "./dates.js";

/** One refresh-worthy input and the highest level the coach said it changes. */
export interface PlanRefreshChange {
  updatedAt: Date;
  planChangeScope: PlanChangeScope;
}

/** One stored input and whether its coach reply asked for a plan change. */
export interface CoachingInputChange {
  updatedAt: Date;
  /** True when the coach asked for a change, or when no reply exists yet. */
  planChangeNeeded: boolean;
  /**
   * The highest level the coach said this input changes. Absent on rows written
   * before the scope existed; the loader then fails open to `season`.
   */
  planChangeScope?: PlanChangeScope | undefined;
}

export interface CoachingInputChangeSummary {
  /** Newest input of any kind, whether or not it asks for a plan change. */
  updatedAt: Date | null;
  /** Newest input whose coach reply asked for a plan change. */
  refreshUpdatedAt: Date | null;
  /**
   * Every refresh-worthy input, so the decision can read the scope of the ones
   * the stored plan has not seen yet. A single newest scope would let a newer
   * day input hide an older season input.
   */
  refreshChanges: readonly PlanRefreshChange[];
}

/** The level a stored input changes, with a missing scope failing open. */
function changeScope(change: CoachingInputChange): PlanChangeScope {
  if (change.planChangeScope !== undefined) {
    return change.planChangeScope;
  }
  return change.planChangeNeeded ? "season" : "none";
}

export function summarizeCoachingInputChanges(
  changes: readonly CoachingInputChange[],
): CoachingInputChangeSummary {
  let updatedAt: Date | null = null;
  let refreshUpdatedAt: Date | null = null;
  const refreshChanges: PlanRefreshChange[] = [];
  for (const change of changes) {
    if (isNewer(change.updatedAt, updatedAt)) {
      updatedAt = change.updatedAt;
    }
    const planChangeScope = changeScope(change);
    if (planChangeScope === "none") {
      continue;
    }
    refreshChanges.push({ updatedAt: change.updatedAt, planChangeScope });
    if (isNewer(change.updatedAt, refreshUpdatedAt)) {
      refreshUpdatedAt = change.updatedAt;
    }
  }
  refreshChanges.sort(
    (left, right) => left.updatedAt.getTime() - right.updatedAt.getTime(),
  );
  return { updatedAt, refreshUpdatedAt, refreshChanges };
}

/** One completed-period event: a generated review or the athlete's comment on it. */
export interface ReviewChange {
  kind: "week" | "block";
  /** When the generated review or its comment arrived. */
  updatedAt: Date;
  /** A generated review always refreshes; a comment follows its reply. */
  planChangeNeeded: boolean;
  /** The highest level the event changes; absent on reviews before the scope. */
  planChangeScope?: PlanChangeScope | undefined;
}

export interface ReviewChangeSummary {
  weekUpdatedAt: Date | null;
  weekNeedsRefresh: boolean;
  /** Scope of the newest week review event, or null when it does not refresh. */
  weekScope: PlanChangeScope | null;
  blockUpdatedAt: Date | null;
  blockNeedsRefresh: boolean;
  /** Scope of the newest block review event, or null when it does not refresh. */
  blockScope: PlanChangeScope | null;
}

/** The level a review event changes, defaulting to its own kind. */
function reviewScope(review: ReviewChange): PlanChangeScope {
  if (review.planChangeScope !== undefined) {
    return review.planChangeScope;
  }
  if (!review.planChangeNeeded) {
    return "none";
  }
  return review.kind === "week" ? "block" : "season";
}

/**
 * The newest event per review kind and whether that event asks for a refresh.
 * Only the newest event matters: an older generated review that the plan already
 * used must not keep the period pending.
 */
export function summarizeReviewChanges(
  reviews: readonly ReviewChange[],
): ReviewChangeSummary {
  const newest = (kind: "week" | "block") => {
    const events = reviews.filter((review) => review.kind === kind);
    let latest: ReviewChange | null = null;
    for (const event of events) {
      if (isNewer(event.updatedAt, latest?.updatedAt)) {
        latest = event;
      }
    }
    return latest;
  };
  const week = newest("week");
  const block = newest("block");
  const weekScope = week === null ? "none" : reviewScope(week);
  const blockScope = block === null ? "none" : reviewScope(block);
  return {
    weekUpdatedAt: week?.updatedAt ?? null,
    weekNeedsRefresh: weekScope !== "none",
    weekScope: weekScope === "none" ? null : weekScope,
    blockUpdatedAt: block?.updatedAt ?? null,
    blockNeedsRefresh: blockScope !== "none",
    blockScope: blockScope === "none" ? null : blockScope,
  };
}
