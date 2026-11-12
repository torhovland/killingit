/**
 * How the stored coaching inputs decide whether the plan needs a refresh.
 *
 * Every input carries the coach's `planChangeNeeded` flag, taken from the reply
 * the coach wrote after reading it. A missing reply fails open: the input keeps
 * refreshing the plan, so a failed reply can never silently drop a change.
 */

/** One stored input and whether its coach reply asked for a plan change. */
export interface CoachingInputChange {
  updatedAt: Date;
  /** True when the coach asked for a change, or when no reply exists yet. */
  planChangeNeeded: boolean;
}

export interface CoachingInputChangeSummary {
  /** Newest input of any kind, whether or not it asks for a plan change. */
  updatedAt: Date | null;
  /** Newest input whose coach reply asked for a plan change. */
  refreshUpdatedAt: Date | null;
}

export function summarizeCoachingInputChanges(
  changes: readonly CoachingInputChange[],
): CoachingInputChangeSummary {
  let updatedAt: Date | null = null;
  let refreshUpdatedAt: Date | null = null;
  for (const change of changes) {
    if (
      updatedAt === null ||
      change.updatedAt.getTime() > updatedAt.getTime()
    ) {
      updatedAt = change.updatedAt;
    }
    if (
      change.planChangeNeeded &&
      (refreshUpdatedAt === null ||
        change.updatedAt.getTime() > refreshUpdatedAt.getTime())
    ) {
      refreshUpdatedAt = change.updatedAt;
    }
  }
  return { updatedAt, refreshUpdatedAt };
}

/** One completed-period event: a generated review or the athlete's comment on it. */
export interface ReviewChange {
  kind: "week" | "block";
  /** When the generated review or its comment arrived. */
  updatedAt: Date;
  /** A generated review always refreshes; a comment follows its reply. */
  planChangeNeeded: boolean;
}

export interface ReviewChangeSummary {
  weekUpdatedAt: Date | null;
  weekNeedsRefresh: boolean;
  blockUpdatedAt: Date | null;
  blockNeedsRefresh: boolean;
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
      if (
        latest === null ||
        event.updatedAt.getTime() > latest.updatedAt.getTime()
      ) {
        latest = event;
      }
    }
    return latest;
  };
  const week = newest("week");
  const block = newest("block");
  return {
    weekUpdatedAt: week?.updatedAt ?? null,
    weekNeedsRefresh: week?.planChangeNeeded ?? false,
    blockUpdatedAt: block?.updatedAt ?? null,
    blockNeedsRefresh: block?.planChangeNeeded ?? false,
  };
}
