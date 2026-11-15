import type { RecentActivityContext } from "../../llm/activityContext.js";
import { toCoachPlanActivity } from "../../llm/activityContext.js";
import { currentTrainingLoad } from "../../training/load.js";
import { ftpBaselineAt, ftpTimeline } from "../../training/thresholds.js";
import type { GeneratePlanInput, PlanGenerationContext } from "./types.js";

/** The season/block model. */
export function seasonModelFor(context: PlanGenerationContext): string {
  return context.seasonModel;
}

/** The week/day model. */
export function dailyModelFor(context: PlanGenerationContext): string {
  return context.dailyModel;
}

/** The provider credentials a prompt call runs with. */
export function credentials(context: PlanGenerationContext, model: string) {
  return {
    apiKey: context.apiKey,
    model,
    signal: context.signal,
  };
}

/**
 * The time zone a run uses for every derived day: the caller's selected or
 * device zone, else the athlete's stored zone. A missing zone reads as UTC.
 */
export function runTimeZone(input: GeneratePlanInput): string | undefined {
  return input.timezone ?? input.context.timeZone ?? undefined;
}

/**
 * The current FTP for prompts and TSS. It comes only from the stored metric
 * series: the coach read the athlete's stated FTP and the API stored it, so no
 * free text is parsed here.
 */
function ftpBaseline(context: PlanGenerationContext, today: string) {
  return ftpBaselineAt(ftpTimeline(context.thresholdTimelines ?? []), today);
}

/** The athlete and training context every plan prompt starts from. */
export function baseContext(input: GeneratePlanInput) {
  const recentActivities: RecentActivityContext[] =
    input.context.activities.map(toCoachPlanActivity);
  // Prefer the stored plan's snapshot because it includes today's planned
  // session; fall back to the recorded history for a plan that has none yet.
  const storedForm =
    input.plan?.plan.today.date === input.today
      ? (input.plan.plan.today.trainingLoad ?? null)
      : null;
  const currentForm =
    storedForm ??
    currentTrainingLoad(
      {
        activities: input.context.activities,
        manualActivities: input.context.manualActivities,
        thresholdTimelines: input.context.thresholdTimelines,
        timeZone: input.context.timeZone,
      },
      input.today,
    );

  const timezone = runTimeZone(input);
  return {
    athleteAnswers: input.context.answers,
    recentActivities,
    currentForm,
    athleteFtpWatts: ftpBaseline(input.context, input.today)?.watts ?? null,
    ftpHistory: input.context.ftpHistory,
    thresholds: input.context.thresholds,
    bodyHistory: input.context.bodyHistory,
    dailyHealth: input.context.dailyHealth,
    events: input.context.events,
    diet: input.context.diet,
    dietGoal: input.context.dietGoal,
    dietAdvice: input.context.dietAdvice,
    calorieHistory: input.context.calorieHistory,
    today: input.today,
    timezone,
    manualActivities: input.context.manualActivities,
    activityComments: input.context.activityComments,
    weeklyNote: input.context.weeklyNote,
    weeklyNoteWeekStartDate: input.context.weeklyNoteWeekStartDate,
    weeklyNoteReply: input.context.weeklyNoteReply,
    periodReviews: input.context.periodReviews,
  };
}

/**
 * Weather is only relevant to the week and day prompts, so it is added to
 * those prompts rather than to the season and block prompts.
 */
export function weatherContext(input: GeneratePlanInput) {
  return {
    forecast: input.context.forecast ?? undefined,
    locationName: input.context.location?.name,
  };
}
