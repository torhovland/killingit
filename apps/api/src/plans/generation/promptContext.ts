import type { RecentActivityContext } from "../../llm/activityContext.js";
import { toCoachPlanActivity } from "../../llm/activityContext.js";
import { currentTrainingLoad } from "../../training/load.js";
import { ftpBaselineAt, ftpTimeline } from "../../training/thresholds.js";
import type { GeneratePlanInput, PlanGenerationContext } from "./types.js";

/** The season/block model, falling back to the daily model. */
export function seasonModelFor(context: PlanGenerationContext): string {
  return context.seasonModel ?? context.model;
}

/** The week/day model, falling back to the daily model. */
export function dailyModelFor(context: PlanGenerationContext): string {
  return context.dailyModel ?? context.model;
}

/** The provider credentials a prompt call runs with. */
export function credentials(
  context: PlanGenerationContext,
  model = context.model,
) {
  return {
    apiKey: context.apiKey,
    model,
    ...(context.signal !== undefined ? { signal: context.signal } : {}),
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
    ...(currentForm !== null ? { currentForm } : {}),
    athleteFtpWatts: ftpBaseline(input.context, input.today)?.watts ?? null,
    ...(input.context.ftpHistory !== undefined
      ? { ftpHistory: input.context.ftpHistory }
      : {}),
    ...(input.context.thresholds !== undefined
      ? { thresholds: input.context.thresholds }
      : {}),
    ...(input.context.bodyHistory !== undefined
      ? { bodyHistory: input.context.bodyHistory }
      : {}),
    ...(input.context.dailyHealth !== undefined
      ? { dailyHealth: input.context.dailyHealth }
      : {}),
    ...(input.context.events !== undefined && input.context.events.length > 0
      ? { events: input.context.events }
      : {}),
    ...(input.context.diet !== undefined ? { diet: input.context.diet } : {}),
    ...(input.context.dietGoal !== undefined
      ? { dietGoal: input.context.dietGoal }
      : {}),
    ...(input.context.dietAdvice !== undefined
      ? { dietAdvice: input.context.dietAdvice }
      : {}),
    ...(input.context.calorieHistory !== undefined &&
    input.context.calorieHistory.length > 0
      ? { calorieHistory: input.context.calorieHistory }
      : {}),
    today: input.today,
    ...(timezone !== undefined ? { timezone } : {}),
    ...(input.context.manualActivities.length > 0
      ? { manualActivities: input.context.manualActivities }
      : {}),
    ...(input.context.activityComments.length > 0
      ? { activityComments: input.context.activityComments }
      : {}),
    ...(input.context.weeklyNote !== null
      ? {
          weeklyNote: input.context.weeklyNote,
          ...(input.context.weeklyNoteWeekStartDate != null
            ? { weeklyNoteWeekStartDate: input.context.weeklyNoteWeekStartDate }
            : {}),
        }
      : {}),
    ...(input.context.weeklyNoteReply != null
      ? { weeklyNoteReply: input.context.weeklyNoteReply }
      : {}),
    ...(input.context.periodReviews !== undefined &&
    input.context.periodReviews.length > 0
      ? { periodReviews: input.context.periodReviews }
      : {}),
  };
}

/**
 * Weather is only relevant to the week and day prompts, so it is added to
 * those prompts rather than to the season and block prompts.
 */
export function weatherContext(input: GeneratePlanInput) {
  const forecast = input.context.forecast;
  if (!forecast || forecast.length === 0) {
    return {};
  }
  const name = input.context.location?.name;
  return {
    forecast,
    ...(name !== undefined && name !== null ? { locationName: name } : {}),
  };
}
