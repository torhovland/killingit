import type { LlmCostBucket } from "@killingit/shared";
import { tickStep } from "./chartGeometry";

/** How far back the monthly cost chart looks. */
export const MONTHLY_COST_RANGES = ["12m", "all"] as const;

export type MonthlyCostRange = (typeof MONTHLY_COST_RANGES)[number];

export const MONTHLY_COST_RANGE_LABELS: Record<MonthlyCostRange, string> = {
  "12m": "Last 12 months",
  all: "All time",
};

/** How far back the daily cost chart looks. */
export const DAILY_COST_RANGES = ["7d", "31d", "365d", "all"] as const;

export type DailyCostRange = (typeof DAILY_COST_RANGES)[number];

export const DAILY_COST_RANGE_LABELS: Record<DailyCostRange, string> = {
  "7d": "Last 7 days",
  "31d": "Last 31 days",
  "365d": "Last 365 days",
  all: "All time",
};

/** One model's total, used to order the stacks and colour the legend. */
export interface CostModelTotal {
  model: string;
  label: string;
  totalUsd: number;
}

/** One model's share of a period. */
export interface CostBucketPart {
  model: string;
  costUsd: number;
  calls: number;
}

/** One bar in the cost chart: a month or a day, split by model. */
export interface CostBucket {
  /** `YYYY-MM` for monthly charts and `YYYY-MM-DD` for daily charts. */
  key: string;
  /** The short axis label. */
  label: string;
  /** The full label shown in the hover card. */
  title: string;
  totalUsd: number;
  parts: CostBucketPart[];
}

/** The values behind one cost bar chart. */
export interface CostChartData {
  buckets: CostBucket[];
  models: CostModelTotal[];
  totalUsd: number;
}

interface Period {
  key: string;
  label: string;
  title: string;
}

/**
 * One entry per model, ordered by total cost so the stacks and the legend use
 * the same order. Shared by both charts so a model keeps its colour when the
 * athlete changes a range.
 */
export function costModels(rows: readonly LlmCostBucket[]): CostModelTotal[] {
  const totals = new Map<string, CostModelTotal>();
  for (const row of rows) {
    const entry = totals.get(row.model) ?? {
      model: row.model,
      label: row.label,
      totalUsd: 0,
    };
    entry.totalUsd += row.costUsd;
    totals.set(row.model, entry);
  }
  return [...totals.values()]
    .map((entry) => ({ ...entry, totalUsd: roundCost(entry.totalUsd) }))
    .sort(
      (left, right) =>
        right.totalUsd - left.totalUsd || left.label.localeCompare(right.label),
    );
}

/** The continuous monthly buckets for one range, empty months included. */
export function monthlyCostChart(
  rows: readonly LlmCostBucket[],
  range: MonthlyCostRange,
  today: string,
): CostChartData {
  const end = today.slice(0, 7);
  const rowsByBucket = rows.filter(
    (row) => row.bucket.length === 7 && row.bucket <= end,
  );
  const earliest = earliestBucket(rowsByBucket);
  const start = range === "12m" ? addMonths(end, -11) : (earliest ?? end);

  const periods = monthsBetween(start, end).map((key) => ({
    key,
    label: monthLabel(key, range === "all"),
    title: monthTitle(key),
  }));
  return buildCostChart(rowsByBucket, periods, rows);
}

/** The continuous daily buckets for one range, empty days included. */
export function dailyCostChart(
  rows: readonly LlmCostBucket[],
  range: DailyCostRange,
  today: string,
): CostChartData {
  const end = today.slice(0, 10);
  const rowsByBucket = rows.filter(
    (row) => row.bucket.length === 10 && row.bucket <= end,
  );
  const earliest = earliestBucket(rowsByBucket);
  const start =
    range === "7d"
      ? addDays(end, -6)
      : range === "31d"
        ? addDays(end, -30)
        : range === "365d"
          ? addDays(end, -364)
          : (earliest ?? end);

  const periods = daysBetween(start, end).map((key) => ({
    key,
    label: formatDay(key),
    title: formatDayTitle(key),
  }));
  return buildCostChart(rowsByBucket, periods, rows);
}

/** A bar's index for a pointer position, given as a share of the plot width. */
export function costBarIndex(fraction: number, count: number): number {
  if (count <= 0 || !Number.isFinite(fraction)) {
    return -1;
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(count - 1, Math.floor(clamped * count));
}

/** The y-axis top and its round ticks for a cost chart. */
export function costAxis(maxValue: number): {
  max: number;
  ticks: number[];
} {
  const top = Math.max(maxValue, 0.0001);
  const step = tickStep(top / 4, 1);
  const max = Math.round(Math.ceil(top / step) * step * 1_000_000) / 1_000_000;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 1000; value += step) {
    ticks.push(Math.round(value * 1_000_000) / 1_000_000);
  }
  return { max, ticks };
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A cost with enough precision to tell small calls apart. */
export function formatCostUsd(value: number): string {
  if (value === 0) {
    return "$0.00";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return MONEY.format(value);
}

/** A compact cost for an axis tick. */
export function formatCostAxis(value: number): string {
  if (value === 0) {
    return "$0";
  }
  if (value < 0.001) {
    return `$${value.toFixed(4)}`;
  }
  if (value < 0.01) {
    return `$${value.toFixed(3)}`;
  }
  return MONEY.format(value);
}

function earliestBucket(rows: readonly LlmCostBucket[]): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    if (earliest === null || row.bucket < earliest) {
      earliest = row.bucket;
    }
  }
  return earliest;
}

function buildCostChart(
  rows: readonly LlmCostBucket[],
  periods: readonly Period[],
  allRows: readonly LlmCostBucket[],
): CostChartData {
  const wanted = new Set(periods.map((period) => period.key));
  const buckets = new Map<string, Map<string, CostBucketPart>>();
  for (const row of rows) {
    if (!wanted.has(row.bucket)) {
      continue;
    }
    const byModel =
      buckets.get(row.bucket) ?? new Map<string, CostBucketPart>();
    const part = byModel.get(row.model) ?? {
      model: row.model,
      costUsd: 0,
      calls: 0,
    };
    part.costUsd += row.costUsd;
    part.calls += row.calls;
    byModel.set(row.model, part);
    buckets.set(row.bucket, byModel);
  }

  let totalUsd = 0;
  const built = periods.map((period) => {
    const parts = [...(buckets.get(period.key)?.values() ?? [])]
      .map((part) => ({ ...part, costUsd: roundCost(part.costUsd) }))
      .sort((left, right) => left.model.localeCompare(right.model));
    const bucketTotal = roundCost(
      parts.reduce((sum, part) => sum + part.costUsd, 0),
    );
    totalUsd += bucketTotal;
    return { ...period, totalUsd: bucketTotal, parts };
  });

  return {
    buckets: built,
    models: costModels(allRows),
    totalUsd: roundCost(totalUsd),
  };
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const FULL_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function monthLabel(key: string, includeYear: boolean): string {
  const [year, month] = key.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? key;
  return includeYear && year !== undefined ? `${name} ${year.slice(2)}` : name;
}

function monthTitle(key: string): string {
  const [year, month] = key.split("-");
  const name = FULL_MONTH_NAMES[Number(month) - 1] ?? key;
  return year === undefined ? name : `${name} ${year}`;
}

function formatDay(key: string): string {
  const [, month, day] = key.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  return name === undefined || day === undefined
    ? key
    : `${Number(day)} ${name}`;
}

function formatDayTitle(key: string): string {
  const [year] = key.split("-");
  return `${formatDay(key)}${year === undefined ? "" : ` ${year}`}`;
}

function addMonths(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number);
  if (year === undefined || value === undefined) {
    return month;
  }
  return new Date(Date.UTC(year, value - 1 + delta, 1))
    .toISOString()
    .slice(0, 7);
}

function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let current = start;
  while (current <= end) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months.length === 0 ? [end] : months;
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  let current = start;
  while (current <= end) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days.length === 0 ? [end] : days;
}

function roundCost(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
