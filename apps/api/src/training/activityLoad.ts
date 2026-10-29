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
 * Power-scored TSS for one activity, or null when it has no usable power or the
 * timeline has no FTP anchor. Movement time is preferred, with elapsed time as
 * the fallback for activities whose source reports no moving time.
 */
export function activityMeasuredTss(
  activity: AnalyzedActivity,
  timeline: FtpTimeline,
): number | null {
  const normalized = activity.normalizedPower;
  if (normalized === null || normalized === undefined) {
    return null;
  }
  const ftpWatts = ftpAt(timeline, activity.startDate);
  if (ftpWatts === null) {
    return null;
  }
  return powerTrainingStressScore({
    durationSeconds: activityDurationSeconds(activity),
    normalizedPowerWatts: normalized,
    ftpWatts,
  });
}

/**
 * Sums the power-scored TSS of every activity on one day, when at least one
 * activity has measured power. Activities without power still contribute their
 * duration-based stress, so a day's total is the sum of its activities.
 * Returns null when nothing on the day can be measured.
 */
export function measuredActivityTss(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
): number | null {
  const measured = activities.map((activity) =>
    activityMeasuredTss(activity, timeline),
  );
  if (!measured.some((value) => value !== null)) {
    return null;
  }
  return activities.reduce(
    (total, activity, index) =>
      total + (measured[index] ?? fallbackActivityTss(activity)),
    0,
  );
}

/** One day's TSS split across its activities, aligned with the input order. */
export interface ActivityDayTss {
  /** The TSS credited to each activity on the day. */
  byActivity: number[];
  /** The day's total TSS, the sum of `byActivity`. */
  total: number;
}

/**
 * Resolves the TSS for one day's activities and for each activity alone.
 *
 * Measured power wins and is combined with the duration-based stress of any
 * unpowered activity on the same day. When no activity has power, the coach's
 * day estimate is split across the activities in proportion to their
 * duration-based stress; without an estimate, each activity keeps that
 * duration-based value.
 */
export function resolveActivityDayTss(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
  estimatedTss?: number,
): ActivityDayTss {
  const measured = activities.map((activity) =>
    activityMeasuredTss(activity, timeline),
  );
  if (measured.some((value) => value !== null)) {
    const byActivity = activities.map(
      (activity, index) => measured[index] ?? fallbackActivityTss(activity),
    );
    return { byActivity, total: sumTss(byActivity) };
  }

  const fallbacks = activities.map(fallbackActivityTss);
  if (estimatedTss !== undefined && estimatedTss > 0) {
    const total = Math.round(estimatedTss);
    return { byActivity: distributeTss(total, fallbacks), total };
  }
  return { byActivity: fallbacks, total: sumTss(fallbacks) };
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
  return resolveActivityDayTss(activities, timeline, estimatedTss).total;
}

/** Day snapshots plus the TSS credited to each individual activity. */
export interface ActivityLoads {
  /** The fitness snapshot for each date. */
  byDate: Map<string, TrainingLoad>;
  /** The TSS credited to each activity, keyed by activity id. */
  byActivityId: Map<number, number>;
}

/**
 * Builds the training-load series over a range that covers every supplied
 * date, together with the TSS each activity contributes on its own. Dates
 * without an activity or estimate count as rest.
 */
export function buildActivityLoads(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
  estimatedTssByDate: ReadonlyMap<string, number> = new Map(),
  extraDates: readonly string[] = [],
): ActivityLoads {
  const byDate = groupActivitiesByDate(activities);
  const seriesInput = new Map<string, number>(estimatedTssByDate);
  const byActivityId = new Map<number, number>();

  for (const [date, entries] of byDate) {
    const resolved = resolveActivityDayTss(
      entries,
      timeline,
      estimatedTssByDate.get(date),
    );
    seriesInput.set(date, resolved.total);
    entries.forEach((activity, index) => {
      byActivityId.set(activity.id, resolved.byActivity[index] ?? 0);
    });
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
    return { byDate: new Map(), byActivityId };
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
  return { byDate: loads, byActivityId };
}

/**
 * Builds the day snapshots over a range that covers every supplied date, and
 * returns the snapshot for each date. Dates without an activity or estimate
 * count as rest.
 */
export function buildActivityTrainingLoads(
  activities: readonly AnalyzedActivity[],
  timeline: FtpTimeline,
  estimatedTssByDate: ReadonlyMap<string, number> = new Map(),
  extraDates: readonly string[] = [],
): Map<string, TrainingLoad> {
  return buildActivityLoads(
    activities,
    timeline,
    estimatedTssByDate,
    extraDates,
  ).byDate;
}

/**
 * A conservative stress estimate for a recorded activity without power. Used
 * only when neither measured power nor the coach's estimate is available.
 */
function fallbackActivityTss(activity: AnalyzedActivity): number {
  if (activity.type === "manual") {
    return 0;
  }
  const seconds = activityDurationSeconds(activity);
  if (seconds <= 0) {
    return 0;
  }
  return Math.round((seconds / 3600) * tssPerHour(activity.type));
}

/** Movement time when the source reports it, otherwise elapsed time. */
function activityDurationSeconds(activity: AnalyzedActivity): number {
  return activity.movingTime > 0 ? activity.movingTime : activity.elapsedTime;
}

function sumTss(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Splits a day's coach estimate across activities by their duration-based
 * stress, using largest remainders so the parts add up to the estimate. With no
 * usable weights the estimate is shared evenly.
 */
function distributeTss(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) {
    return [];
  }
  const weightSum = sumTss(weights);
  if (weightSum <= 0) {
    const even = Math.floor(total / weights.length);
    return weights.map((_, index) =>
      index === 0 ? total - even * (weights.length - 1) : even,
    );
  }

  const exact = weights.map((weight) => (weight / weightSum) * total);
  const parts = exact.map((value) => Math.floor(value));
  let remaining = total - sumTss(parts);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - (parts[index] ?? 0) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of byRemainder) {
    if (remaining <= 0) {
      break;
    }
    parts[index] = (parts[index] ?? 0) + 1;
    remaining -= 1;
  }
  return parts;
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
