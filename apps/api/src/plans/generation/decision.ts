import type {
  CoachPlan,
  PlanChangeScope,
  PlanPending,
} from "@killingit/shared";
import {
  planChangeScopeIncludes,
  widestPlanChangeScope,
} from "@killingit/shared";
import { planWeatherChanged } from "../../weather/changes.js";
import type { PeriodReviewContext } from "../../llm/planContext.js";
import { isNewer } from "../dates.js";
import type { PlanRefreshChange } from "../inputChanges.js";
import { planIsStale, planPending } from "../status.js";
import type { StoredPlan } from "../store.js";
import { ensureGenerationCurrent } from "./persist.js";
import { runTimeZone, seasonModelFor } from "./promptContext.js";
import type {
  GeneratePlanInput,
  PlanGenerationContext,
  RevisionDecision,
} from "./types.js";

/**
 * The widest scope among the refresh-worthy events the plan has not seen.
 * Undefined means the caller supplied no per-event scopes, so the decision keeps
 * the pre-scope behaviour of revising the week and today.
 */
function unseenPlanChangeScope(
  changes: readonly PlanRefreshChange[] | undefined,
  since: Date | null,
): PlanChangeScope | undefined {
  if (changes === undefined) {
    return undefined;
  }
  return widestPlanChangeScope(
    changes
      .filter((change) => isNewer(change.updatedAt, since))
      .map((change) => change.planChangeScope),
  );
}

interface RefreshScopeInput {
  context: PlanGenerationContext;
  plan: StoredPlan | null;
  inputsChanged: boolean;
  activitiesChanged: boolean;
  weekReviewNewer: boolean;
  blockReviewNewer: boolean;
}

/**
 * The widest level the unseen inputs, analyses and reviews change. A caller
 * without per-event scopes keeps the old week-and-day behaviour, and a review
 * keeps its structural default (`block` for a week, `season` for a block).
 */
function refreshScopeFor(input: RefreshScopeInput): PlanChangeScope {
  const { context, plan, inputsChanged, activitiesChanged } = input;
  const inputScope = inputsChanged
    ? (unseenPlanChangeScope(
        context.coachingInputsRefreshChanges,
        plan?.coachingInputsUpdatedAt ?? null,
      ) ?? "day")
    : "none";
  const activityScope = activitiesChanged
    ? (unseenPlanChangeScope(
        context.activitiesRefreshChanges,
        plan?.activitiesUpdatedAt ?? null,
      ) ?? "day")
    : "none";
  const legacyReviewScopes: PlanChangeScope[] = [];
  if (context.coachingInputsRefreshChanges === undefined) {
    if (input.weekReviewNewer) {
      legacyReviewScopes.push("block");
    }
    if (input.blockReviewNewer) {
      legacyReviewScopes.push("season");
    }
  }
  return widestPlanChangeScope([
    inputScope,
    activityScope,
    ...legacyReviewScopes,
  ]);
}

/**
 * The two ways a run treats the stored season, and whether it instead builds
 * every level.
 */
interface SeasonChoice {
  refreshSeason: boolean;
  needsFullPlan: boolean;
}

/**
 * Whether this run refreshes the stored season in place or builds every level.
 * An explicit update, a saved answer, or a season-scoped input refreshes the
 * existing season; a missing plan, a forced rebuild, a deliberately new season,
 * or a refresh with no season covering today builds all four levels.
 */
function seasonChoice(input: {
  force: boolean | undefined;
  mode: GeneratePlanInput["mode"];
  stale: boolean;
  refreshScope: PlanChangeScope;
  currentPlan: CoachPlan | null;
  today: string;
}): SeasonChoice {
  const refreshRequested =
    input.mode === "updateSeason" ||
    (input.mode === "auto" && (input.stale || input.refreshScope === "season"));
  const refreshSeason =
    input.force !== true &&
    input.mode !== "newSeason" &&
    refreshRequested &&
    input.currentPlan !== null &&
    seasonCovers(input.currentPlan.season, input.today);
  const needsFullPlan =
    input.currentPlan === null ||
    input.force === true ||
    input.mode === "newSeason" ||
    (refreshRequested && !refreshSeason);
  return { refreshSeason, needsFullPlan };
}

/**
 * Decides how this run must treat the stored plan. A missing, forced or
 * deliberately new season is rebuilt; a changed input, a completed block's
 * review, a season-scoped input or an explicit update refreshes the stored
 * season in place; anything else only advances the levels that are missing. An
 * input whose coach reply judged it context only is acknowledged without a plan
 * completion.
 */
export function decideRevisionPlan(
  input: GeneratePlanInput,
  currentPlan: CoachPlan | null,
): RevisionDecision {
  const { context, plan, today } = input;
  const mode = input.mode ?? "auto";
  const stale =
    plan !== null &&
    planIsStale(plan.answersUpdatedAt, context.answersUpdatedAt);
  const inputsRefreshUpdatedAt = context.coachingInputsRefreshUpdatedAt;
  const inputsChanged =
    plan !== null &&
    isNewer(inputsRefreshUpdatedAt, plan.coachingInputsUpdatedAt);
  // Compare against the analyses included in the plan, not when the plan was
  // saved: an import can finish while a generation is running, so the plan
  // may be newer than its save time yet still not contain the activity.
  const activitiesRefreshUpdatedAt = context.activitiesRefreshUpdatedAt;
  const activitiesChanged =
    plan !== null &&
    isNewer(activitiesRefreshUpdatedAt, plan.activitiesUpdatedAt);
  // A newly generated week review, or an answer to one that asked for a plan
  // change, makes the block pending. The block is revised in place when today
  // is still inside it.
  const weekReviewNewer =
    plan !== null &&
    context.weekReviewNeedsRefresh !== false &&
    isNewer(context.weekReviewUpdatedAt, plan.coachingInputsUpdatedAt);
  // A newly generated block review, or an answer that asked for a change,
  // refreshes the remaining season around what the completed block achieved.
  const blockReviewNewer =
    plan !== null &&
    context.blockReviewNeedsRefresh !== false &&
    isNewer(context.blockReviewUpdatedAt, plan.coachingInputsUpdatedAt);
  // The scope is the widest the coach chose among the events this plan has not
  // seen. A day-scoped comment must not hide an older season-scoped note, and
  // an event the plan already used must not widen later runs.
  const refreshScope = refreshScopeFor({
    context,
    plan,
    inputsChanged,
    activitiesChanged,
    weekReviewNewer,
    blockReviewNewer,
  });
  // A week review whose reply only reaches the week revises the week; it does
  // not make the block pending. A generated review, or one scoped to the block,
  // does.
  const weekReviewPending =
    weekReviewNewer && planChangeScopeIncludes(refreshScope, "block");
  const revisionNeeded =
    inputsChanged || activitiesChanged || weekReviewPending;
  // The plan still stores the newest input and analysis of any kind, so a
  // context-only input is recorded once and never triggers another run.
  const unreviewedInputs =
    plan !== null &&
    isNewer(context.coachingInputsUpdatedAt, plan.coachingInputsUpdatedAt);
  const unreviewedActivities =
    plan !== null &&
    isNewer(context.activitiesUpdatedAt, plan.activitiesUpdatedAt);
  const acknowledgementNeeded =
    (unreviewedInputs && !inputsChanged) ||
    (unreviewedActivities && !activitiesChanged);
  // An explicit update, a saved answer, or a season-scoped input refreshes the
  // existing season instead of silently starting a new one. A block or week
  // review only refreshes the season when its own scope reaches that far.
  // Without a season that covers today there is nothing to refresh.
  const { refreshSeason, needsFullPlan } = seasonChoice({
    force: input.force,
    mode,
    stale,
    refreshScope,
    currentPlan,
    today,
  });
  // The forecast can move enough to make the stored week's weather advice
  // wrong even when every level is present. Treat that like any other week
  // revision so the coach can move sessions to the better days.
  const weatherChanged =
    currentPlan !== null &&
    context.forecast != null &&
    planWeatherChanged(currentPlan, context.forecast, today);
  return {
    needsFullPlan,
    kind: refreshSeason ? "refresh" : "advance",
    revisionNeeded,
    refreshScope,
    pending: planPending({
      plan: currentPlan,
      today,
      includeTomorrow: input.includeTomorrow === true,
      weatherChanged,
      weekReviewPending,
      dietAdvice: context.dietAdvice === true,
    }),
    weekReviewPending,
    acknowledgementNeeded,
  };
}

/** True when no level is missing and no new input has to reach the plan. */
export function planIsIdle(
  pending: PlanPending,
  revisionNeeded: boolean,
): boolean {
  return (
    !pending.block &&
    !pending.week &&
    !pending.day &&
    !pending.tomorrow &&
    !pending.nextWeek &&
    !pending.nextBlock &&
    !pending.dietProgress &&
    !revisionNeeded
  );
}

/**
 * Captures a review for every completed period this run is about to replace.
 * Returns the context the rest of the run must use: the caller's context with
 * the new reviews merged in, so the block update can use them immediately and
 * the block becomes pending in the same visit. The caller's input is not
 * modified.
 */
export async function captureEndedPeriodReviews(
  input: GeneratePlanInput,
  today: string,
): Promise<PlanGenerationContext> {
  const context = input.context;
  if (input.plan === null || input.capturePeriodReviews === undefined) {
    return context;
  }
  const timezone = runTimeZone(input);
  const captured = await input.capturePeriodReviews({
    userId: input.userId,
    today,
    timezone,
    plan: input.plan.plan,
    provider: context.provider,
    apiKey: context.apiKey,
    model: seasonModelFor(context),
    athleteAnswers: context.answers,
    activities: context.recentActivities ?? context.activities,
    manualActivities: context.manualActivities,
    activityComments: context.activityComments,
    weeklyNote: context.weeklyNote,
    dailyHealth: context.dailyHealth,
    events: context.events,
    diet: context.diet,
    signal: input.signal,
  });
  await ensureGenerationCurrent(input);
  if (captured === undefined || captured.length === 0) {
    return context;
  }
  return mergeCapturedPeriodReviews(context, captured);
}

/**
 * Adds reviews generated at the start of this run to the context before the
 * plan update. A new week review also advances the coaching-input timestamp, so
 * the saved plan records that it already used the review.
 */
function mergeCapturedPeriodReviews(
  context: PlanGenerationContext,
  captured: readonly PeriodReviewContext[],
): PlanGenerationContext {
  const capturedAt = (kind: "week" | "block"): Date | null => {
    const review = captured.find((entry) => entry.kind === kind);
    if (review === undefined) {
      return null;
    }
    const at =
      review.updatedAt === undefined ? new Date() : new Date(review.updatedAt);
    return Number.isNaN(at.getTime()) ? null : at;
  };
  const weekReviewUpdatedAt =
    capturedAt("week") ?? context.weekReviewUpdatedAt ?? null;
  const blockReviewUpdatedAt =
    capturedAt("block") ?? context.blockReviewUpdatedAt ?? null;
  return {
    ...context,
    periodReviews: [...(context.periodReviews ?? []), ...captured],
    weekReviewUpdatedAt,
    blockReviewUpdatedAt,
    coachingInputsUpdatedAt: latestDate(
      latestDate(context.coachingInputsUpdatedAt, weekReviewUpdatedAt),
      blockReviewUpdatedAt,
    ),
  };
}

function latestDate(
  first: Date | null | undefined,
  second: Date | null | undefined,
): Date | null {
  if (first == null) {
    return second ?? null;
  }
  if (second == null) {
    return first;
  }
  return isNewer(second, first) ? second : first;
}

/** True when `today` falls inside the season's dates. */
function seasonCovers(season: CoachPlan["season"], today: string): boolean {
  return today >= season.startDate && today <= season.endDate;
}
