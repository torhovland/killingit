import type { AnalyzedActivity, WeekPlan } from "@killingit/shared";
import type { ManualActivityContext } from "../llm/planContext.js";

/**
 * Replaces planned sessions on days before `today` with what actually
 * happened: a matching activity becomes a `completed` session and an unfulfilled
 * workout becomes `missed`. Today and future days stay `planned` (or `rest`).
 * Past days never carry future suggestions. Manually recorded activities are
 * treated exactly like synced activities.
 */
export function applyCompletedDays(
  week: WeekPlan,
  activities: readonly AnalyzedActivity[],
  today: string,
  manualActivities: readonly ManualActivityContext[] = [],
): WeekPlan {
  const allActivities: AnalyzedActivity[] = [
    ...activities,
    ...manualActivities.map((manual) => ({
      id: manual.id,
      name: manual.details,
      type: "manual",
      startDate: manual.startDate,
      distance: 0,
      movingTime: 0,
      elapsedTime: 0,
      totalElevationGain: 0,
      samples: [],
      sampleCount: 0,
      analysis: null,
      analysisError: null,
    })),
  ];

  const activityByDate = new Map<string, AnalyzedActivity>();
  for (const activity of allActivities) {
    const date = activity.startDate.slice(0, 10);
    if (!activityByDate.has(date)) {
      activityByDate.set(date, activity);
    }
  }

  const sessions = week.sessions.map((session) => {
    if (session.date >= today) {
      return {
        ...session,
        status: session.type === "rest" ? "rest" : "planned",
      } as const;
    }

    const activity = activityByDate.get(session.date);
    if (activity) {
      return {
        ...session,
        type: "workout",
        title: activity.name,
        description: describeActivity(activity),
        durationMinutes: Math.max(1, Math.round(activity.movingTime / 60)),
        status: "completed",
      } as const;
    }

    if (session.type === "rest") {
      return { ...session, status: "rest" } as const;
    }

    return {
      ...session,
      title: "No activity recorded",
      description: "The athlete did not record a workout for this day.",
      durationMinutes: 0,
      status: "missed",
    } as const;
  });

  return { ...week, sessions };
}

function describeActivity(activity: AnalyzedActivity): string {
  const parts: string[] = [activity.type];
  if (activity.distance > 0) {
    parts.push(`${(activity.distance / 1000).toFixed(2)} km`);
  }
  parts.push(`${Math.round(activity.movingTime / 60)} min`);
  if (activity.totalElevationGain > 0) {
    parts.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }
  return `Completed: ${parts.join(" · ")}`;
}
