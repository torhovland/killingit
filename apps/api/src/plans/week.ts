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
 * `todayPlan`, when supplied, is mirrored into today's week session so the day
 * and week views agree on the title, description, and completion status.
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
      if (!activity) {
        // Keep a completed/partial day and its week session in agreement even
        // when the activity itself is not in this generation's context.
        if (
          todayPlan?.status === "completed" ||
          todayPlan?.status === "partial"
        ) {
          return mirrorToday(session, null, todayPlan);
        }
        return {
          ...session,
          status: session.type === "rest" ? "rest" : "planned",
        } as const;
      }
      return mirrorToday(session, activity, todayPlan);
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
 * Mirrors today's generated day plan into the week. The coach's `partial`
 * verdict is preserved; when it only says `planned`, fall back to comparing the
 * activity with the planned session.
 */
function mirrorToday(
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

  if (!todayPlan) {
    if (!activity) {
      return { ...session, status };
    }
    return {
      ...session,
      type: "workout",
      title: activity.name,
      description: describeActivity(activity),
      durationMinutes: durationMinutesFor(activity),
      status,
    };
  }

  return {
    ...session,
    type: todayPlan.type,
    title: todayPlan.title,
    description: todayPlan.description,
    durationMinutes: todayPlan.durationMinutes,
    intensity: todayPlan.intensity,
    status,
    ...(todayPlan.outdoor !== undefined ? { outdoor: todayPlan.outdoor } : {}),
    ...(todayPlan.canBeOutdoor !== undefined
      ? { canBeOutdoor: todayPlan.canBeOutdoor }
      : {}),
  };
}

/**
 * Copies a generated day plan into its week session so the Day and Week views
 * cannot disagree about the session. Throws when the day does not belong to the
 * week, which would mean the coach returned inconsistent levels.
 */
export function mirrorDay(week: WeekPlan, day: DayPlan): WeekPlan {
  if (!week.sessions.some((session) => session.date === day.date)) {
    throw new Error(
      "The coach returned a session that is not in the planned week.",
    );
  }
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date === day.date
        ? {
            ...session,
            type: day.type,
            title: day.title,
            description: day.description,
            durationMinutes: day.durationMinutes,
            intensity: day.intensity,
            status: day.status,
            ...(day.outdoor !== undefined ? { outdoor: day.outdoor } : {}),
            ...(day.canBeOutdoor !== undefined
              ? { canBeOutdoor: day.canBeOutdoor }
              : {}),
          }
        : session,
    ),
  };
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
