import {
  activityAverageSpeed,
  activityLocalDate,
  formatActivityPaceOrSpeed,
  formatActivityType,
  type AnalyzedActivity,
  type DayPlan,
  type WeekPlan,
  type WeekSession,
  type WeekSessionStatus,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/activityContext.js";

/** The minimum an activity needs to settle a planned session's completion. */
type RecordedEffort = Pick<AnalyzedActivity, "type" | "elapsedTime">;

/**
 * Every activity recorded on `date`, synced or manual. A manual entry carries
 * the day the athlete entered rather than a UTC instant, and has no measured
 * duration, so it is adapted to a recorded activity here and nowhere else.
 */
export function activitiesOnDate(
  activities: readonly AnalyzedActivity[],
  manualActivities: readonly ManualActivityContext[],
  timeZone: string | null | undefined,
  date: string,
): AnalyzedActivity[] {
  const recorded = activities.filter(
    (activity) => activityLocalDate(activity, timeZone) === date,
  );
  const manual = manualActivities
    .filter((activity) => activity.startDate === date)
    .map(manualActivity);
  return [...recorded, ...manual];
}

function manualActivity(manual: ManualActivityContext): AnalyzedActivity {
  return {
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
  };
}

/**
 * Settles today's status from what was recorded. Without a recorded activity
 * today cannot be completed; with one, the coach's `completed` or `partial`
 * verdict is kept, because it can see the activity's analysis and comments, and
 * a coach that only said `planned` is overruled by the recorded duration
 * compared with the planned session (with slack).
 */
export function todayCompletionStatus(
  planned: Pick<WeekSession, "type" | "durationMinutes">,
  activities: readonly RecordedEffort[],
  coachStatus: WeekSessionStatus | undefined,
): WeekSessionStatus {
  if (activities.length === 0) {
    return planned.type === "rest" ? "rest" : "planned";
  }
  if (coachStatus === "completed" || coachStatus === "partial") {
    return coachStatus;
  }
  return completionStatus(planned, activities);
}

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
  timeZone: string | null | undefined,
  manualActivities: readonly ManualActivityContext[] = [],
  todayPlan?: DayPlan,
): WeekPlan {
  const sessions = week.sessions.map((session) => {
    const dayActivities = activitiesOnDate(
      activities,
      manualActivities,
      timeZone,
      session.date,
    );

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

/** Settles today's completion status on the week's outline. */
function settleTodaySession(
  session: WeekSession,
  activities: readonly AnalyzedActivity[],
  todayPlan: DayPlan | undefined,
): WeekSession {
  const status = todayCompletionStatus(session, activities, todayPlan?.status);

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
function completionStatus(
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
  const averageSpeed = activityAverageSpeed(activity);
  if (averageSpeed !== null) {
    const paceOrSpeed = formatActivityPaceOrSpeed(activity.type, averageSpeed);
    if (paceOrSpeed !== null) {
      parts.push(paceOrSpeed);
    }
  }
  parts.push(`${Math.round(activity.elapsedTime / 60)} min`);
  if (activity.totalElevationGain > 0) {
    parts.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }
  return parts.join(" · ");
}
