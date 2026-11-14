import type { FinalizePlanInput } from "../finalize.js";
import type { GeneratePlanInput } from "./types.js";

/**
 * The athlete data a plan finalisation reads. `plannedToday` is left to the
 * caller: a run that revised today judges the completion against the stored
 * session, and every other run against the plan it is finalising.
 */
export function finalizeInput(input: GeneratePlanInput): FinalizePlanInput {
  const { context, today } = input;
  return {
    today,
    includeTomorrow: input.includeTomorrow === true,
    activities: context.activities,
    manualActivities: context.manualActivities,
    ...(context.timeZone !== undefined ? { timeZone: context.timeZone } : {}),
    ...(context.thresholdTimelines !== undefined
      ? { thresholdTimelines: context.thresholdTimelines }
      : {}),
    ...(context.weatherForecasts !== undefined
      ? { weatherForecasts: context.weatherForecasts }
      : {}),
    ...(context.forecast !== undefined ? { forecast: context.forecast } : {}),
  };
}
