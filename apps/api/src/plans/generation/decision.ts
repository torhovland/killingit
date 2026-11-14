import type { CoachPlan, PlanPending } from "@killingit/shared";
import { planWeatherChanged } from "../../weather/changes.js";
import type { PeriodReviewContext } from "../../llm/planContext.js";
import { planIsStale, planPending } from "../status.js";
import { ensureGenerationCurrent } from "./persist.js";
import { runTimeZone, seasonModelFor } from "./promptContext.js";
import type {
  GeneratePlanInput,
  PlanGenerationContext,
  RevisionDecision,
} from "./types.js";

/**
 * Decides how this run must treat the stored plan. A missing, forced or
 * deliberately new season is rebuilt; a changed input, a completed block's
 * review or an explicit update refreshes the stored season in place; anything
 * else only advances the levels that are missing. An input whose coach reply
 * judged it context only is acknowledged without a plan completion.
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
  const inputsRefreshUpdatedAt =
    context.coachingInputsRefreshUpdatedAt !== undefined
      ? context.coachingInputsRefreshUpdatedAt
      : context.coachingInputsUpdatedAt;
  const inputsChanged =
    plan !== null &&
    inputsRefreshUpdatedAt !== null &&
    (plan.coachingInputsUpdatedAt === null ||
      inputsRefreshUpdatedAt.getTime() >
        plan.coachingInputsUpdatedAt.getTime());
  // Compare against the analyses included in the plan, not when the plan was
  // saved: an import can finish while a generation is running, so the plan
  // may be newer than its save time yet still not contain the activity.
  const activitiesRefreshUpdatedAt =
    context.activitiesRefreshUpdatedAt !== undefined
      ? context.activitiesRefreshUpdatedAt
      : context.activitiesUpdatedAt;
  const activitiesChanged =
    plan !== null &&
    activitiesRefreshUpdatedAt != null &&
    (plan.activitiesUpdatedAt === null ||
      activitiesRefreshUpdatedAt.getTime() >
        plan.activitiesUpdatedAt.getTime());
  // A newly generated week review, or an answer to one that asked for a plan
  // change, makes the block pending. The block is revised in place when today
  // is still inside it.
  const weekReviewPending =
    plan !== null &&
    context.weekReviewUpdatedAt != null &&
    context.weekReviewNeedsRefresh !== false &&
    (plan.coachingInputsUpdatedAt === null ||
      context.weekReviewUpdatedAt.getTime() >
        plan.coachingInputsUpdatedAt.getTime());
  // A newly generated block review, or an answer that asked for a change,
  // refreshes the remaining season around what the completed block achieved.
  const blockReviewPending =
    plan !== null &&
    context.blockReviewUpdatedAt != null &&
    context.blockReviewNeedsRefresh !== false &&
    (plan.coachingInputsUpdatedAt === null ||
      context.blockReviewUpdatedAt.getTime() >
        plan.coachingInputsUpdatedAt.getTime());
  const revisionNeeded =
    inputsChanged || activitiesChanged || weekReviewPending;
  // The plan still stores the newest input and analysis of any kind, so a
  // context-only input is recorded once and never triggers another run.
  const unreviewedInputs =
    plan !== null &&
    context.coachingInputsUpdatedAt !== null &&
    (plan.coachingInputsUpdatedAt === null ||
      context.coachingInputsUpdatedAt.getTime() >
        plan.coachingInputsUpdatedAt.getTime());
  const unreviewedActivities =
    plan !== null &&
    context.activitiesUpdatedAt != null &&
    (plan.activitiesUpdatedAt === null ||
      context.activitiesUpdatedAt.getTime() >
        plan.activitiesUpdatedAt.getTime());
  const acknowledgementNeeded =
    (unreviewedInputs && !inputsChanged) ||
    (unreviewedActivities && !activitiesChanged);
  // An explicit update, a saved answer, or a completed block's review
  // refreshes the existing season instead of silently starting a new one.
  // Without a season that covers today there is nothing to refresh.
  const refreshRequested =
    mode === "updateSeason" ||
    (mode === "auto" && (stale || blockReviewPending));
  const refreshSeason =
    input.force !== true &&
    mode !== "newSeason" &&
    refreshRequested &&
    currentPlan !== null &&
    seasonCovers(currentPlan.season, today);
  // A missing plan, a deliberate fresh start, or an update with no usable
  // season builds a new season. A refresh of an existing season uses the
  // single plan-update prompt so the season, block, week and day agree.
  const needsFullPlan =
    currentPlan === null ||
    input.force === true ||
    mode === "newSeason" ||
    (refreshRequested && !refreshSeason);
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
    ...(timezone !== undefined ? { timezone } : {}),
    plan: input.plan.plan,
    provider: context.provider,
    apiKey: context.apiKey,
    model: seasonModelFor(context),
    athleteAnswers: context.answers,
    activities: context.activities,
    manualActivities: context.manualActivities,
    activityComments: context.activityComments,
    weeklyNote: context.weeklyNote,
    ...(context.dailyHealth !== undefined
      ? { dailyHealth: context.dailyHealth }
      : {}),
    ...(context.events !== undefined ? { events: context.events } : {}),
    ...(context.diet !== undefined ? { diet: context.diet } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
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
  return second.getTime() > first.getTime() ? second : first;
}

/** True when `today` falls inside the season's dates. */
function seasonCovers(season: CoachPlan["season"], today: string): boolean {
  return today >= season.startDate && today <= season.endDate;
}
