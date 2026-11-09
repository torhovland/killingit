import {
  DAILY_HEALTH_METRIC_KEYS,
  DAILY_HEALTH_METRICS,
  formatDailyHealthValue,
  withoutInProgressDailyHealth,
  type DailyHealthMetricKey,
  type DailyHealthPoint,
} from "@killingit/shared";
import { addDays } from "@killingit/shared";

/** How much recovery history the coach sees in a prompt. */
export const HEALTH_CONTEXT_DAYS = 14;

/** Options for the daily health prompt summary. */
export interface DailyHealthContextOptions {
  /** How many days of history to include. */
  days?: number;
  /**
   * The real current date. The current day's running values (Body Battery high
   * and low) are still in progress, so the summary uses the last completed day.
   */
  today?: string;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trendText(
  metric: DailyHealthMetricKey,
  current: number,
  previous: number,
): string {
  const difference = current - previous;
  const definition = DAILY_HEALTH_METRICS[metric];
  const threshold = 0.5 * 10 ** -definition.decimals;
  if (Math.abs(difference) < threshold) {
    return "unchanged from the previous week";
  }
  const direction = difference > 0 ? "up" : "down";
  return `${direction} ${formatDailyHealthValue(metric, Math.abs(difference))} from the previous week`;
}

/**
 * Renders a compact, deterministic recovery summary for a prompt: the latest
 * value and the 7-day average for every metric, with the change from the
 * previous week when both windows have data.
 */
export function formatDailyHealthContext(
  points: readonly DailyHealthPoint[],
  throughDate: string,
  options: DailyHealthContextOptions = {},
): string[] {
  const days = options.days ?? HEALTH_CONTEXT_DAYS;
  const fromDate = addDays(throughDate, -(days - 1));
  const source =
    options.today === undefined
      ? points
      : withoutInProgressDailyHealth(points, options.today);
  const byMetric = new Map<DailyHealthMetricKey, Map<string, number>>();
  for (const point of source) {
    if (point.date < fromDate || point.date > throughDate) {
      continue;
    }
    const series = byMetric.get(point.metric) ?? new Map<string, number>();
    series.set(point.date, point.value);
    byMetric.set(point.metric, series);
  }

  const lines = [
    `Daily health and recovery (from Garmin, ${days} days through ${throughDate}):`,
  ];
  if (byMetric.size === 0) {
    lines.push("- No daily health data was synced for this period.");
    return lines;
  }

  const currentFrom = addDays(throughDate, -6);
  const previousFrom = addDays(throughDate, -13);
  const previousThrough = addDays(throughDate, -7);

  for (const metric of DAILY_HEALTH_METRIC_KEYS) {
    const series = byMetric.get(metric);
    if (series === undefined || series.size === 0) {
      continue;
    }
    const dates = [...series.keys()].sort();
    const latestDate = dates[dates.length - 1] ?? throughDate;
    const latest = series.get(latestDate);
    if (latest === undefined) {
      continue;
    }

    const current = dates
      .filter((date) => date >= currentFrom && date <= throughDate)
      .map((date) => series.get(date))
      .filter((value): value is number => value !== undefined);
    const previous = dates
      .filter((date) => date >= previousFrom && date <= previousThrough)
      .map((date) => series.get(date))
      .filter((value): value is number => value !== undefined);

    const currentAverage = average(current);
    const previousAverage = average(previous);
    const parts = [
      `latest ${formatDailyHealthValue(metric, latest)} on ${latestDate}`,
    ];
    if (currentAverage !== null && current.length >= 2) {
      parts.push(
        `7-day average ${formatDailyHealthValue(metric, currentAverage)}`,
      );
    }
    if (currentAverage !== null && previousAverage !== null) {
      parts.push(trendText(metric, currentAverage, previousAverage));
    }
    lines.push(`- ${DAILY_HEALTH_METRICS[metric].label}: ${parts.join("; ")}.`);
  }

  return lines;
}
