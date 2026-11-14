import type { DailyHealthMetricKey, DailyHealthPoint } from "@killingit/shared";

/**
 * Metrics that are running values for the current day rather than a completed
 * daily summary. A morning value is only the high or low so far, so the coach
 * and the Fitness page use the last completed day until this day is over. The
 * stored catalog of metrics is shared, but this reading rule serves the API's
 * prompts and charts only. See ADR 0055.
 */
const IN_PROGRESS_DAILY_HEALTH_METRICS: readonly DailyHealthMetricKey[] = [
  "body_battery_high",
  "body_battery_low",
];

/** True when a metric is a running value for the current day. */
function isInProgressDailyHealthMetric(metric: DailyHealthMetricKey): boolean {
  return IN_PROGRESS_DAILY_HEALTH_METRICS.includes(metric);
}

/**
 * Drops the current day's still-in-progress values from a daily health series,
 * so a reader shows the last completed day instead of a partial morning value.
 */
export function withoutInProgressDailyHealth(
  points: readonly DailyHealthPoint[],
  today: string,
): DailyHealthPoint[] {
  return points.filter(
    (point) =>
      point.date !== today || !isInProgressDailyHealthMetric(point.metric),
  );
}
