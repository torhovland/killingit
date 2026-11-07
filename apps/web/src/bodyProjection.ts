import type { FitnessDietTarget } from "@killingit/shared";
import { addDays } from "./calendarDates";

/** One point on the dotted diet-target line. */
export interface BodyTargetPoint {
  date: string;
  value: number;
}

/** The two measures the Body chart can target. */
export type DietTargetMeasure = "weightKg" | "bodyFatPercent";

/** A generous cap so a malformed season end cannot loop forever. */
const MAX_FUTURE_DAYS = 3660;

/** The last point on or before `date`; the series is ascending. */
export function lastPointOnOrBefore<T extends { date: string }>(
  points: readonly T[],
  date: string,
): T | null {
  let last: T | null = null;
  for (const point of points) {
    if (point.date > date) {
      break;
    }
    last = point;
  }
  return last;
}

/**
 * Builds the dotted target line: today's current value, then every future
 * target for the chosen measure up to `throughDate`, ascending. Returns an
 * empty list when there is no starting value or no future target, so the chart
 * never draws a lone marker as a line.
 */
export function dietTargetSeries(
  targets: readonly FitnessDietTarget[],
  measure: DietTargetMeasure,
  start: BodyTargetPoint | null,
  throughDate: string,
): BodyTargetPoint[] {
  if (start === null) {
    return [];
  }
  const future = new Map<string, number>();
  for (const target of targets) {
    if (target.date <= start.date || target.date > throughDate) {
      continue;
    }
    const value = target[measure];
    if (value === null || value === undefined) {
      continue;
    }
    future.set(target.date, value);
  }
  if (future.size === 0) {
    return [];
  }
  return [
    start,
    ...[...future.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value })),
  ];
}

/**
 * The target line's value on `date`, interpolated between the surrounding
 * targets. Null outside the line, so a past day never claims a target.
 */
export function dietTargetValueAt(
  points: readonly BodyTargetPoint[],
  date: string,
): number | null {
  if (points.length === 0) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  if (date < first.date || date > last.date) {
    return null;
  }
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    const left = points[index - 1];
    if (left === undefined || right === undefined) {
      continue;
    }
    if (date === right.date) {
      return right.value;
    }
    if (date < right.date) {
      const span = daysBetween(left.date, right.date);
      if (span <= 0) {
        return right.value;
      }
      const fraction = daysBetween(left.date, date) / span;
      return left.value + (right.value - left.value) * fraction;
    }
  }
  return last.value;
}

/** The days after `start` through `end`, inclusive, capped for safety. */
export function datesAfter(start: string, end: string): { date: string }[] {
  const days: { date: string }[] = [];
  let date = addDays(start, 1);
  while (date <= end && days.length < MAX_FUTURE_DAYS) {
    days.push({ date });
    date = addDays(date, 1);
  }
  return days;
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.round((end - start) / 86_400_000);
}
