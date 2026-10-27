import {
  CTL_DAYS,
  dailyTrainingLoad,
  powerTrainingStressScore,
  type AnalyzedActivity,
  type TrainingLoad,
} from "@killingit/shared";
import { addDays } from "../plans/dates.js";
import { ftpAt, type FtpTimeline } from "./ftp.js";

/** Groups activities by their local calendar date (`YYYY-MM-DD`). */
export function groupActivitiesByDate(
  activities: readonly AnalyzedActivity[],
): Map<string, AnalyzedActivity[]> {
  const grouped = new Map<string, AnalyzedActivity[]>();
  for (const activity of activities) {
    const date = activity.startDate.slice(0, 10);
    const entries = grouped.get(date);
    if (entries) {
      entries.push(activity);
    } else {
      grouped.set(date, [activity]);
    }
  }
  return grouped;
}

/**
 * Sums the power-scored TSS of every activity on one day, when measured power
 * and an FTP anchor are available. Returns null when nothing can be measured.
 */
export function measuredActivityTss(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
): number | null {
  let total: number | null = null;
  for (const activity of activities) {
    const normalized = activity.normalizedPower;
    if (normalized === null || normalized === undefined) {
      continue;
    }
    const ftpWatts = ftpAt(timeline, activity.startDate);
    if (ftpWatts === null) {
      continue;
    }
    const durationSeconds =
      activity.movingTime > 0 ? activity.movingTime : activity.elapsedTime;
    const tss = powerTrainingStressScore({
      durationSeconds,
      normalizedPowerWatts: normalized,
      ftpWatts,
    });
    if (tss !== null) {
      total = (total ?? 0) + tss;
    }
  }
  return total;
}

/**
 * The TSS for one day's activities: measured power first, then the coach's
 * estimate, then a duration-based fallback.
 */
export function activityDayTss(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
  estimatedTss?: number,
): number {
  const measured = measuredActivityTss(activities, timeline);
  if (measured !== null) {
    return measured;
  }
  if (estimatedTss !== undefined && estimatedTss > 0) {
    return Math.round(estimatedTss);
  }
  return activities.reduce(
    (total, activity) => total + fallbackActivityTss(activity),
    0,
  );
}

/**
 * Builds the training-load series over a range that covers every supplied
 * date, and returns the snapshot for each date. Dates without an activity or
 * estimate count as rest.
 */
export function buildActivityTrainingLoads(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
  estimatedTssByDate: ReadonlyMap<string, number> = new Map(),
  extraDates: readonly string[] = [],
): Map<string, TrainingLoad> {
  const byDate = groupActivitiesByDate(activities);
  const seriesInput = new Map<string, number>(estimatedTssByDate);

  for (const [date, entries] of byDate) {
    seriesInput.set(
      date,
      activityDayTss(entries, timeline, estimatedTssByDate.get(date)),
    );
  }
  for (const date of extraDates) {
    if (!seriesInput.has(date)) {
      seriesInput.set(date, 0);
    }
  }

  const dates = [...seriesInput.keys()].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) {
    return new Map();
  }

  const series = dailyTrainingLoad({
    startDate: addDays(first, -CTL_DAYS),
    endDate: last,
    tssByDate: seriesInput,
  });
  const loads = new Map<string, TrainingLoad>();
  for (const date of dates) {
    const load = series.get(date);
    if (load !== undefined) {
      loads.set(date, load);
    }
  }
  return loads;
}

/**
 * A conservative stress estimate for a recorded activity without power. Used
 * only when neither measured power nor the coach's estimate is available.
 */
function fallbackActivityTss(activity: AnalyzedActivity): number {
  if (activity.type === "manual" || activity.movingTime <= 0) {
    return 0;
  }
  const hours = activity.movingTime / 3600;
  return Math.round(hours * tssPerHour(activity.type));
}

function tssPerHour(type: string): number {
  const normalized = type.toLowerCase();
  if (normalized.includes("cycl") || normalized.includes("bik")) {
    return 55;
  }
  if (normalized.includes("run")) {
    return 65;
  }
  if (normalized.includes("hik")) {
    return 45;
  }
  if (normalized.includes("walk")) {
    return 35;
  }
  if (normalized.includes("strength") || normalized.includes("weight")) {
    return 40;
  }
  if (normalized.includes("row") || normalized.includes("ski")) {
    return 50;
  }
  return 45;
}
