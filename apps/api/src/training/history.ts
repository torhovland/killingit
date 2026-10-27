import {
  CTL_DAYS,
  dailyTrainingLoad,
  formatActivityType,
  type AnalyzedActivity,
  type BlockWeekSummary,
  type CoachPlan,
  type FitnessDayActivity,
  type FitnessDayPlan,
  type FitnessHistoryDay,
  type FitnessHistoryResponse,
  type FitnessRange,
  type FtpHistoryPoint,
  type WeekPlan,
} from "@killingit/shared";
import type { ManualActivityContext } from "../llm/planContext.js";
import { addDays, startOfWeek } from "../plans/dates.js";
import { activityDayTss, groupActivitiesByDate } from "./activityLoad.js";
import { loadTrainingContext } from "./context.js";
import { ftpAt, type FtpTimeline } from "./ftp.js";

/** How many days of history each fixed range covers, today included. */
export const FITNESS_RANGE_DAYS: Record<
  Exclude<FitnessRange, "all">,
  number
> = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

export interface FitnessHistoryInput {
  /** The athlete's current date; the window ends here unless the plan runs on. */
  today: string;
  /** How far back to look. `all` starts at the first recorded activity. */
  range: FitnessRange;
  activities: readonly AnalyzedActivity[];
  timeline: FtpTimeline;
  plan?: CoachPlan | undefined;
  /** TSS the stored plan contributes for the days it covers. */
  planTssByDate: ReadonlyMap<string, number>;
  /** Summed coach estimate for each day with manual entries. */
  manualTssByDate: ReadonlyMap<string, number>;
  /** The athlete's manual entries, listed on the day they were logged. */
  manualActivities?: readonly ManualActivityContext[] | undefined;
}

/**
 * Builds the Fitness page's daily series. TSS is resolved exactly as on the
 * Activities page (measured power, then the coach's estimate, then a manual
 * entry, then the duration fallback), and the window is not extended into the
 * past beyond what was requested: days without training count as rest.
 */
export function buildFitnessHistory(
  input: FitnessHistoryInput,
): FitnessHistoryResponse {
  const { startDate, endDate } = fitnessWindow({
    today: input.today,
    range: input.range,
    plan: input.plan,
    earliestDate: earliestRecordedDate(
      input.activities,
      input.manualActivities ?? [],
    ),
  });
  // Same precedence as the Activities page: a manual entry replaces the plan's
  // estimate for its date, and measured power wins over either.
  const tssByDate = new Map(input.planTssByDate);
  for (const [date, tss] of input.manualTssByDate) {
    tssByDate.set(date, tss);
  }
  for (const [date, activities] of groupActivitiesByDate(input.activities)) {
    tssByDate.set(
      date,
      activityDayTss(activities, input.timeline, tssByDate.get(date)),
    );
  }

  const series = dailyTrainingLoad({
    startDate: addDays(startDate, -CTL_DAYS),
    endDate,
    tssByDate,
  });
  const activitiesByDate = activitiesPerDay(
    input.activities,
    input.manualActivities ?? [],
  );
  const plannedByDate = plannedSessions(input.plan);
  const days: FitnessHistoryDay[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const load = series.get(date);
    if (load !== undefined) {
      days.push({
        date,
        ...load,
        activities: activitiesByDate.get(date) ?? [],
        planned: plannedByDate.get(date) ?? null,
      });
    }
  }

  return { days, ftp: ftpHistory(input.timeline, input.plan, days) };
}

/** The stored plan's session for each day it covers. */
function plannedSessions(
  plan: CoachPlan | undefined,
): Map<string, FitnessDayPlan> {
  const result = new Map<string, FitnessDayPlan>();
  if (plan === undefined) {
    return result;
  }
  const sessions = [...plan.week.sessions, ...(plan.nextWeek?.sessions ?? [])];
  for (const session of sessions) {
    if (session.type === "rest") {
      continue;
    }
    result.set(session.date, {
      title: session.title,
      durationMinutes: session.durationMinutes,
    });
  }
  return result;
}

/** The earliest activity the athlete recorded or logged by hand. */
export function earliestRecordedDate(
  activities: readonly AnalyzedActivity[],
  manualActivities: readonly ManualActivityContext[],
): string | null {
  const dates = [
    ...activities.map((activity) => activity.startDate.slice(0, 10)),
    ...manualActivities.map((manual) => manual.startDate),
  ].sort();
  return dates[0] ?? null;
}

/**
 * The activities logged on each day, for the chart's hover card. Imported
 * activities come first; manual entries follow with the athlete's description.
 */
function activitiesPerDay(
  activities: readonly AnalyzedActivity[],
  manualActivities: readonly ManualActivityContext[],
): Map<string, FitnessDayActivity[]> {
  const result = new Map<string, FitnessDayActivity[]>();
  const add = (date: string, entry: FitnessDayActivity): void => {
    const entries = result.get(date);
    if (entries === undefined) {
      result.set(date, [entry]);
    } else {
      entries.push(entry);
    }
  };

  for (const activity of activities) {
    add(activity.startDate.slice(0, 10), {
      id: `activity-${activity.id}`,
      name: activity.name.trim() || formatActivityType(activity.type),
      type: activity.type,
      ...(activity.movingTime > 0
        ? { durationMinutes: Math.round(activity.movingTime / 60) }
        : {}),
    });
  }
  for (const manual of manualActivities) {
    add(manual.startDate, {
      id: `manual-${manual.id}`,
      name: manual.details,
      type: "manual",
    });
  }
  return result;
}

/** Loads the cached activities and stores the fitness history for the page. */
export async function loadFitnessHistory(
  userId: number,
  activities: readonly AnalyzedActivity[],
  plan: CoachPlan | undefined,
  today: string,
  range: FitnessRange,
): Promise<FitnessHistoryResponse> {
  const context = await loadTrainingContext(userId, plan);
  return buildFitnessHistory({
    today,
    range,
    activities,
    plan,
    timeline: context.timeline,
    planTssByDate: context.planTssByDate,
    manualTssByDate: context.manualTssByDate,
    manualActivities: context.manualActivities,
  });
}

/**
 * The first and last day of the chart. The start follows the chosen range; the
 * end is the later of today and the stored plan's last day, so the chart runs
 * exactly as far ahead as there are planned workouts.
 */
export function fitnessWindow(input: {
  today: string;
  range: FitnessRange;
  plan?: CoachPlan | undefined;
  /** The first recorded or manually logged activity, for the `all` range. */
  earliestDate?: string | null | undefined;
}): { startDate: string; endDate: string } {
  const earliest = input.earliestDate ?? null;
  const startDate =
    input.range === "all"
      ? earliest !== null && earliest < input.today
        ? earliest
        : addDays(input.today, -6)
      : addDays(input.today, -(FITNESS_RANGE_DAYS[input.range] - 1));
  const plannedEnd = plannedEndDate(input.plan);
  return {
    startDate: startDate <= input.today ? startDate : input.today,
    endDate:
      plannedEnd !== null && plannedEnd > input.today
        ? plannedEnd
        : input.today,
  };
}

/**
 * The estimated FTP for each day: the stored plan's weekly estimate where the
 * plan covers the day, otherwise the athlete's interpolated timeline value.
 * Empty when the athlete has never stated an FTP.
 */
function ftpHistory(
  timeline: FtpTimeline,
  plan: CoachPlan | undefined,
  days: readonly { date: string }[],
): FtpHistoryPoint[] {
  const weekly = weeklyFtpEstimates(plan);
  const points: FtpHistoryPoint[] = [];
  for (const { date } of days) {
    const watts = weekly.get(startOfWeek(date)) ?? ftpAt(timeline, date);
    if (watts !== null) {
      points.push({ date, watts });
    }
  }
  return points;
}

/** The coach's estimate for every week the stored plan describes. */
function weeklyFtpEstimates(plan: CoachPlan | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (plan === undefined) {
    return result;
  }
  addBlockWeeks(result, plan.block.weeks);
  if (plan.nextBlock !== null) {
    addBlockWeeks(result, plan.nextBlock.weeks);
  }
  addWeekEstimate(result, plan.week);
  addWeekEstimate(result, plan.nextWeek);
  return result;
}

function addBlockWeeks(
  result: Map<string, number>,
  weeks: readonly BlockWeekSummary[],
): void {
  for (const week of weeks) {
    const watts = week.estimatedFtpWatts;
    if (watts !== null && watts !== undefined) {
      result.set(week.startDate, watts);
    }
  }
}

function addWeekEstimate(
  result: Map<string, number>,
  week: WeekPlan | null,
): void {
  if (week === null) {
    return;
  }
  const watts = week.estimatedFtpWatts;
  if (watts !== null && watts !== undefined) {
    result.set(week.startDate, watts);
  }
}

/** The last date the stored plan describes. */
function plannedEndDate(plan: CoachPlan | undefined): string | null {
  if (plan === undefined) {
    return null;
  }
  const dates = [
    ...plan.week.sessions.map((session) => session.date),
    ...(plan.nextWeek?.sessions.map((session) => session.date) ?? []),
  ];
  return dates.sort().at(-1) ?? null;
}
