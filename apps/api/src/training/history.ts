import {
  CTL_DAYS,
  dailyTrainingLoad,
  type AnalyzedActivity,
  type BlockWeekSummary,
  type CoachPlan,
  type FitnessHistoryDay,
  type FitnessHistoryResponse,
  type FtpHistoryPoint,
  type WeekPlan,
} from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";
import { activityDayTss, groupActivitiesByDate } from "./activityLoad.js";
import { loadTrainingContext } from "./context.js";
import { ftpAt, type FtpTimeline } from "./ftp.js";

/** The window the Fitness page requests by default. */
export const DEFAULT_FITNESS_DAYS = 90;
export const MIN_FITNESS_DAYS = 7;
export const MAX_FITNESS_DAYS = 365;

/** Keeps the requested window inside the range the page supports. */
export function clampFitnessDays(days: number): number {
  if (!Number.isFinite(days)) {
    return DEFAULT_FITNESS_DAYS;
  }
  return Math.min(
    MAX_FITNESS_DAYS,
    Math.max(MIN_FITNESS_DAYS, Math.round(days)),
  );
}

export interface FitnessHistoryInput {
  /** The athlete's current date; the window ends here unless the plan runs on. */
  today: string;
  /** Requested window length in days, clamped by `clampFitnessDays`. */
  days: number;
  activities: readonly AnalyzedActivity[];
  timeline: FtpTimeline;
  plan?: CoachPlan | undefined;
  /** TSS the stored plan contributes for the days it covers. */
  planTssByDate: ReadonlyMap<string, number>;
  /** Summed coach estimate for each day with manual entries. */
  manualTssByDate: ReadonlyMap<string, number>;
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
  const { startDate, endDate } = fitnessWindow(
    input.today,
    input.days,
    input.plan,
  );
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
  const days: FitnessHistoryDay[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const load = series.get(date);
    if (load !== undefined) {
      days.push({ date, ...load });
    }
  }

  return { days, ftp: ftpHistory(input.timeline, input.plan, days) };
}

/** Loads the cached activities and stores the fitness history for the page. */
export async function loadFitnessHistory(
  userId: number,
  activities: readonly AnalyzedActivity[],
  plan: CoachPlan | undefined,
  today: string,
  days: number,
): Promise<FitnessHistoryResponse> {
  const context = await loadTrainingContext(userId, plan);
  return buildFitnessHistory({
    today,
    days,
    activities,
    plan,
    timeline: context.timeline,
    planTssByDate: context.planTssByDate,
    manualTssByDate: context.manualTssByDate,
  });
}

/** The first and last day of the chart, covering the stored plan's last day. */
export function fitnessWindow(
  today: string,
  days: number,
  plan?: CoachPlan,
): { startDate: string; endDate: string } {
  const length = clampFitnessDays(days);
  const plannedEnd = plannedEndDate(plan);
  return {
    startDate: addDays(today, -(length - 1)),
    endDate: plannedEnd !== null && plannedEnd > today ? plannedEnd : today,
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
