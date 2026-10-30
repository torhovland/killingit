import {
  formatActivityType,
  type AnalyzedActivity,
  type DayPlan,
  type WeekPlan,
  type WeekSession,
  type WeekSessionStatus,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/planContext.js";

/**
 * Replaces planned sessions on days up to and including `today` with what
 * actually happened: an activity becomes `completed` when it substantially
 * matched the planned session and `partial` when it did not. An unfulfilled
 * past workout becomes `missed`. Future days stay `planned` (or `rest`). Past
 * days never carry future suggestions. Manually recorded activities are treated
 * exactly like synced activities.
 *
 * Today's week session keeps its outline, because the detailed prescription
 * lives in the day plan; only its completion status is settled here. `todayPlan`
 * supplies that verdict when the coach already gave one.
 */
export function applyCompletedDays(
  week: WeekPlan,
  activities: readonly AnalyzedActivity[],
  today: string,
  manualActivities: readonly ManualActivityContext[] = [],
  todayPlan?: DayPlan,
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
      programAnalysis: null,
      comment: null,
      coachReply: null,
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
    const activity = activityByDate.get(session.date);

    if (session.date > today) {
      return {
        ...session,
        status: session.type === "rest" ? "rest" : "planned",
      } as const;
    }

    if (session.date === today) {
      return settleTodaySession(session, activity ?? null, todayPlan);
    }

    if (activity) {
      return {
        ...session,
        type: "workout",
        title: activity.name,
        description: describeActivity(activity),
        // A manual entry has no measured duration; do not invent one.
        durationMinutes: durationMinutesFor(activity),
        // The coach has the full activity and comments, so keep its `partial`
        // verdict. Without one, a recorded activity counts as completed.
        status: session.status === "partial" ? "partial" : "completed",
        // The recorded activity replaced the prescription, so its power targets
        // no longer describe the day.
        bikeWorkout: null,
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

/**
 * Settles today's completion status on the week's outline. The coach's
 * `partial` verdict is preserved; when it only says `planned`, fall back to
 * comparing the activity with the planned session.
 */
function settleTodaySession(
  session: WeekSession,
  activity: AnalyzedActivity | null,
  todayPlan: DayPlan | undefined,
): WeekSession {
  const status =
    todayPlan?.status === "completed" || todayPlan?.status === "partial"
      ? todayPlan.status
      : activity
        ? completionStatus(session, activity)
        : session.type === "rest"
          ? "rest"
          : "planned";
  // A planned rest day keeps its outline unless the athlete trained anyway;
  // then the week shows a brief record of what was done instead.
  if (session.type === "rest" && activity !== null) {
    return {
      ...session,
      type: "workout",
      title: activity.name,
      description: describeActivity(activity),
      durationMinutes: durationMinutesFor(activity),
      status,
      bikeWorkout: null,
    };
  }
  return { ...session, status };
}

/**
 * Judges a recorded activity against the planned session's duration. A little
 * slack is intentional: a 60-minute ride recorded as 50 minutes is still
 * completed, and small power/pace-zone deviations do not make a session partial.
 */
export function completionStatus(
  planned: Pick<WeekSession, "type" | "durationMinutes">,
  activity: Pick<AnalyzedActivity, "type" | "elapsedTime">,
): Extract<WeekSessionStatus, "completed" | "partial"> {
  // A manual entry carries no measured duration, so it cannot be judged partial.
  if (activity.type === "manual" || planned.type === "rest") {
    return "completed";
  }
  if (planned.durationMinutes <= 0) {
    return "completed";
  }
  const actual = Math.round(activity.elapsedTime / 60);
  const slack = Math.max(10, Math.round(planned.durationMinutes * 0.15));
  return actual >= planned.durationMinutes - slack ? "completed" : "partial";
}

function durationMinutesFor(activity: AnalyzedActivity): number {
  return activity.type === "manual"
    ? 0
    : Math.max(1, Math.round(activity.elapsedTime / 60));
}

function describeActivity(activity: AnalyzedActivity): string {
  if (activity.type === "manual") {
    // Manual entries only carry a date and free text; there is no duration or
    // distance to report.
    return "Completed: logged manually";
  }

  const parts: string[] = [formatActivityType(activity.type)];
  if (activity.distance > 0) {
    parts.push(`${(activity.distance / 1000).toFixed(2)} km`);
  }
  parts.push(`${Math.round(activity.elapsedTime / 60)} min`);
  if (activity.totalElevationGain > 0) {
    parts.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }
  return `Completed: ${parts.join(" · ")}`;
}
