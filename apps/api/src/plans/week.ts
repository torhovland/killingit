import {
  formatActivityType,
  type AnalyzedActivity,
  type DayPlan,
  type WeekPlan,
  type WeekSession,
  type WeekSessionStatus,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/planContext.js";

/** The minimum an activity needs to settle a planned session's completion. */
type RecordedEffort = Pick<AnalyzedActivity, "type" | "elapsedTime">;

/**
 * Settles the week plan's past and present days from what actually happened.
 * The week is always an outline: a recorded activity settles the session's
 * status but does not replace its planned title, description, duration or
 * intensity. An unfulfilled past workout keeps its outline and is marked
 * `missed`. Future days stay `planned` (or `rest`). Manually recorded activities
 * are treated exactly like synced activities.
 *
 * The one exception is a planned rest day on which the athlete trained: there
 * is no planned workout to keep, so the session shows a brief record of what
 * was done instead.
 *
 * `todayPlan`, when supplied, supplies today's completion verdict because the
 * detailed prescription lives in the day plan.
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

  const activitiesByDate = new Map<string, AnalyzedActivity[]>();
  for (const activity of allActivities) {
    const date = activity.startDate.slice(0, 10);
    const forDate = activitiesByDate.get(date);
    if (forDate) {
      forDate.push(activity);
    } else {
      activitiesByDate.set(date, [activity]);
    }
  }

  const sessions = week.sessions.map((session) => {
    const dayActivities = activitiesByDate.get(session.date) ?? [];

    if (session.date > today) {
      return {
        ...session,
        status: session.type === "rest" ? "rest" : "planned",
      } as const;
    }

    if (session.date === today) {
      return settleTodaySession(session, dayActivities, todayPlan);
    }

    // A day that has already arrived keeps its outline. The activity's own
    // analysis, the Activities page and the completed-period review describe
    // what happened; the week only records whether the session was completed.
    if (session.type === "rest") {
      return dayActivities.length > 0
        ? activityRecord(session, dayActivities, "completed")
        : ({ ...session, status: "rest" } as const);
    }

    return {
      ...session,
      status:
        dayActivities.length > 0
          ? session.status === "partial"
            ? "partial"
            : "completed"
          : "missed",
    } as const;
  });

  return { ...week, sessions };
}

/**
 * Settles today's completion status on the week's outline. The coach's
 * `partial` verdict is preserved; when it only says `planned`, fall back to
 * comparing the recorded activities with the planned session.
 */
function settleTodaySession(
  session: WeekSession,
  activities: readonly AnalyzedActivity[],
  todayPlan: DayPlan | undefined,
): WeekSession {
  const status: WeekSessionStatus =
    todayPlan?.status === "completed" || todayPlan?.status === "partial"
      ? todayPlan.status
      : activities.length > 0
        ? completionStatus(session, activities)
        : session.type === "rest"
          ? "rest"
          : "planned";

  // A planned rest day keeps its outline unless the athlete trained anyway;
  // then the week shows a brief record of what was done instead.
  if (session.type === "rest" && activities.length > 0) {
    return activityRecord(session, activities, status);
  }
  return { ...session, status };
}

/** A brief record for a rest day on which the athlete trained anyway. */
function activityRecord(
  session: WeekSession,
  activities: readonly AnalyzedActivity[],
  status: WeekSessionStatus,
): WeekSession {
  return {
    ...session,
    type: "workout",
    title: activities.map((activity) => activity.name).join(" + "),
    description: describeActivities(activities),
    // A manual entry has no measured duration; do not invent one.
    durationMinutes: totalMinutes(activities),
    status,
    // The recorded activity replaced the prescription, so its power targets
    // no longer describe the day.
    bikeWorkout: null,
  };
}

/**
 * Judges recorded activities against the planned session's total duration. A
 * little slack is intentional: a 60-minute ride recorded as 50 minutes is still
 * completed, and small power/pace-zone deviations do not make a session partial.
 * Several activities on one day count together, because the day's session may
 * prescribe more than one.
 */
export function completionStatus(
  planned: Pick<WeekSession, "type" | "durationMinutes">,
  recorded: readonly RecordedEffort[],
): Extract<WeekSessionStatus, "completed" | "partial"> {
  // A rest day is completed by any activity; a manual entry carries no measured
  // duration, so it cannot be judged partial.
  if (planned.type === "rest") {
    return "completed";
  }
  const measured = recorded.filter((activity) => activity.type !== "manual");
  if (measured.length === 0 || planned.durationMinutes <= 0) {
    return "completed";
  }
  const actualMinutes =
    measured.reduce((total, activity) => total + activity.elapsedTime, 0) / 60;
  const actual = Math.round(actualMinutes);
  const slack = Math.max(10, Math.round(planned.durationMinutes * 0.15));
  return actual >= planned.durationMinutes - slack ? "completed" : "partial";
}

function totalMinutes(activities: readonly AnalyzedActivity[]): number {
  const seconds = activities.reduce(
    (total, activity) =>
      total + (activity.type === "manual" ? 0 : activity.elapsedTime),
    0,
  );
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
}

function describeActivities(activities: readonly AnalyzedActivity[]): string {
  if (activities.every((activity) => activity.type === "manual")) {
    // Manual entries only carry a date and free text; there is no duration or
    // distance to report.
    return "Completed: logged manually";
  }

  return `Completed: ${activities
    .map((activity) =>
      activity.type === "manual"
        ? activity.name
        : describeMeasuredActivity(activity),
    )
    .join("; ")}`;
}

function describeMeasuredActivity(activity: AnalyzedActivity): string {
  const parts: string[] = [formatActivityType(activity.type)];
  if (activity.distance > 0) {
    parts.push(`${(activity.distance / 1000).toFixed(2)} km`);
  }
  parts.push(`${Math.round(activity.elapsedTime / 60)} min`);
  if (activity.totalElevationGain > 0) {
    parts.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }
  return parts.join(" · ");
}
