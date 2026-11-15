import {
  DAILY_HEALTH_METRICS,
  formatDailyHealthValue,
  type DailyHealthMetricKey,
  type DailyHealthPoint,
  type FitnessHistoryDay,
} from "@killingit/shared";
import type { ChartLegendItem } from "../../charts/ChartLegend";
import { niceDomain, type Domain } from "../../charts/chartGeometry";
import { seriesClass } from "../../charts/seriesClass";

/** One line in a recovery chart, with its value on every chart day. */
export interface HealthSeries {
  key: DailyHealthMetricKey;
  label: string;
  values: readonly (number | null)[];
  format: (value: number) => string;
  /** The line's stroke class, from the health chart palette. */
  stroke: string | undefined;
  /** The legend swatch's background class. */
  swatch: string | undefined;
}

/** The series and y domain shared by the resting-heart-rate and score charts. */
export interface HealthLineChartData {
  series: readonly HealthSeries[];
  domain: Domain;
}

/** One layer of the stacked sleep chart. */
export interface SleepLayer {
  key: DailyHealthMetricKey;
  className: string;
  top: readonly (number | null)[];
  bottom: readonly (number | null)[];
}

/** The stacked sleep stages, their totals and the values behind the tooltip. */
export interface SleepChartData {
  series: readonly HealthSeries[];
  layers: readonly SleepLayer[];
  awake: readonly (number | null)[];
  total: readonly (number | null)[];
  domain: Domain;
}

/** Every recovery and sleep chart the fitness page can draw. */
export interface DailyHealthChartData {
  restingHeartRate: HealthLineChartData | null;
  score: HealthLineChartData | null;
  sleep: SleepChartData | null;
}

type HealthByDate = Map<string, Map<DailyHealthMetricKey, number>>;

/**
 * The recovery and sleep colours keep their meaning: primary is the main
 * recovery measure, muted marks light sleep, fresh is REM and destructive is
 * stress. `seriesClass` owns the palette wrap.
 */
const HEALTH_SERIES_PALETTE = [
  { stroke: "stroke-primary", background: "bg-primary" },
  { stroke: "stroke-chart-ink-muted", background: "bg-chart-ink-muted" },
  { stroke: "stroke-form-fresh-line", background: "bg-form-fresh-line" },
  { stroke: "stroke-destructive", background: "bg-destructive" },
] as const;

/** The classes for a series at `index` in the health chart palette. */
function healthColor(index: number): {
  stroke: string | undefined;
  swatch: string | undefined;
} {
  const colours = seriesClass(index, HEALTH_SERIES_PALETTE);
  return { stroke: colours?.stroke, swatch: colours?.background };
}

function healthByDate(points: readonly DailyHealthPoint[]): HealthByDate {
  const result: HealthByDate = new Map();
  for (const point of points) {
    const day =
      result.get(point.date) ?? new Map<DailyHealthMetricKey, number>();
    day.set(point.metric, point.value);
    result.set(point.date, day);
  }
  return result;
}

function metricValues(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
  metric: DailyHealthMetricKey,
): (number | null)[] {
  return days.map((day) => byDate.get(day.date)?.get(metric) ?? null);
}

function hasValues(series: readonly HealthSeries[]): boolean {
  return series.some((entry) =>
    entry.values.some((value) => value !== null && value !== undefined),
  );
}

function formatBpm(value: number): string {
  return `${Math.round(value)} bpm`;
}

function formatScore(value: number): string {
  return `${Math.round(value)}`;
}

function lineSeries(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
  metric: DailyHealthMetricKey,
  format: (value: number) => string,
  colourIndex: number,
): HealthSeries {
  return {
    key: metric,
    label: DAILY_HEALTH_METRICS[metric].label,
    values: metricValues(days, byDate, metric),
    format,
    ...healthColor(colourIndex),
  };
}

/** A line chart when at least one of its series has a value. */
function lineChart(series: HealthSeries[], domain: Domain) {
  return hasValues(series) ? { series, domain } : null;
}

function restingHeartRateChart(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
): HealthLineChartData | null {
  const series = lineSeries(days, byDate, "resting_heart_rate", formatBpm, 0);
  const values = series.values.filter(
    (value): value is number => value !== null,
  );
  return lineChart([series], niceDomain(values, { minSpan: 10 }));
}

function scoreChart(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
): HealthLineChartData | null {
  const series = [
    lineSeries(days, byDate, "body_battery_high", formatScore, 2),
    lineSeries(days, byDate, "sleep_score", formatScore, 0),
    lineSeries(days, byDate, "stress", formatScore, 3),
  ];
  return lineChart(series, { min: 0, max: 100 });
}

/**
 * The stacked sleep-stage series. A missing stage counts as zero inside a night
 * that has other stages, while a night with no sleep at all stays blank.
 */
function sleepChart(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
): SleepChartData | null {
  const deep = metricValues(days, byDate, "deep_sleep");
  const light = metricValues(days, byDate, "light_sleep");
  const rem = metricValues(days, byDate, "rem_sleep");
  const awake = metricValues(days, byDate, "awake_sleep");
  const total = days.map((_, index) => {
    const parts = [deep[index], light[index], rem[index]];
    if (parts.every((value) => value === null || value === undefined)) {
      return null;
    }
    return parts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  });
  const totalValues = total.filter(
    (value): value is number => value !== null && value !== undefined,
  );
  if (totalValues.length === 0) {
    return null;
  }
  const domain = {
    min: 0,
    max: Math.max(60, niceDomain(totalValues, { minSpan: 120 }).max),
  };
  const zeroFilled = (values: readonly (number | null)[]) =>
    values.map((value, index) => (total[index] === null ? null : (value ?? 0)));
  const deepValues = zeroFilled(deep);
  const lightValues = zeroFilled(light);
  const remValues = zeroFilled(rem);
  const lightTop = deepValues.map((value, index) =>
    value === null ? null : value + (lightValues[index] ?? 0),
  );
  const remTop = lightTop.map((value, index) =>
    value === null ? null : value + (remValues[index] ?? 0),
  );
  return {
    domain,
    awake,
    total,
    series: [
      lineSeries(days, byDate, "deep_sleep", sleepFormat("deep_sleep"), 0),
      lineSeries(days, byDate, "light_sleep", sleepFormat("light_sleep"), 1),
      lineSeries(days, byDate, "rem_sleep", sleepFormat("rem_sleep"), 2),
    ],
    layers: [
      {
        key: "deep_sleep",
        className: "fill-primary/25 stroke-primary",
        top: deepValues,
        bottom: total.map(() => 0),
      },
      {
        key: "light_sleep",
        className: "fill-chart-ink-muted/20 stroke-chart-ink-muted",
        top: lightTop,
        bottom: deepValues,
      },
      {
        key: "rem_sleep",
        className: "fill-form-fresh/20 stroke-form-fresh-line",
        top: remTop,
        bottom: lightTop,
      },
    ],
  };
}

function sleepFormat(metric: DailyHealthMetricKey): (value: number) => string {
  return (value) => formatDailyHealthValue(metric, value);
}

/**
 * Shapes the daily health points into the recovery and sleep charts. Returns
 * `null` when Garmin has not recorded any recovery or sleep measure.
 */
export function prepareDailyHealthCharts(
  days: readonly FitnessHistoryDay[],
  points: readonly DailyHealthPoint[],
): DailyHealthChartData | null {
  const byDate = healthByDate(points);
  const restingHeartRate = restingHeartRateChart(days, byDate);
  const score = scoreChart(days, byDate);
  const sleep = sleepChart(days, byDate);
  if (restingHeartRate === null && score === null && sleep === null) {
    return null;
  }
  return { restingHeartRate, score, sleep };
}

/** The sleep chart's legend; Awake has no stacked layer, so it has no swatch. */
export function sleepLegendItems(data: SleepChartData): ChartLegendItem[] {
  return [
    ...data.series.map((entry) => ({
      key: entry.key,
      label: entry.label,
      swatch: entry.swatch,
      swatchShape: "bar" as const,
    })),
    { key: "awake", label: "Awake", swatchShape: "none" as const },
  ];
}
