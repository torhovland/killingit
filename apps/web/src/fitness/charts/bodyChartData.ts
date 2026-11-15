import type {
  FitnessDietTarget,
  FitnessHistoryDay,
  FitnessMetricPoint,
} from "@killingit/shared";
import type { ChartLegendItem } from "../../charts/ChartLegend";
import {
  axisTicks,
  chartScale,
  lastIndexOnOrBefore,
  niceDomain,
  type ChartScale,
  type Domain,
} from "../../charts/chartGeometry";
import {
  datesAfter,
  dietTargetSeries,
  dietTargetValueAt,
  lastPointOnOrBefore,
  type BodyTargetPoint,
} from "../bodyProjection";

/** The inputs the body chart needs before it can shape its series. */
export interface BodyChartInput {
  days: readonly Pick<FitnessHistoryDay, "date">[];
  weight: readonly FitnessMetricPoint[];
  bodyFat: readonly FitnessMetricPoint[];
  /** The last measured day; later days are a projection. */
  today: string;
  /** The stored season's last day, when a season plan exists. */
  seasonEndDate?: string | null;
  /** The coach's future body-composition targets. */
  dietTargets?: readonly FitnessDietTarget[];
  /** Whether to extend the x-axis to the season end. */
  showFuture?: boolean;
}

/** One prepared body measure with its own y axis. */
export interface BodySeries {
  key: "weight" | "body-fat";
  points: readonly FitnessMetricPoint[];
  domain: Domain;
  scale: ChartScale;
}

/** The body chart's series, scales, axes and hover lookups. */
export interface BodyChartData {
  chartDays: readonly { date: string }[];
  weight: BodySeries | null;
  bodyFat: BodySeries | null;
  weightTargets: readonly BodyTargetPoint[];
  fatTargets: readonly BodyTargetPoint[];
  /** The left scale, falling back to body fat when weight is missing. */
  yScale: ChartScale;
  /** The left-axis ticks; empty when only body fat is available. */
  ticks: readonly number[];
  /** The grid follows whichever measure owns the left scale. */
  gridTicks: readonly number[];
  rightTicks: readonly number[] | undefined;
  /** The last measured day's index, where the solid line becomes dotted. */
  split: number;
  dayIndex: ReadonlyMap<string, number>;
  canShowFuture: boolean;
}

/** The values behind the body chart's hover card on one day. */
export interface BodyHoverValues {
  weight: number | null;
  fat: number | null;
  targetWeight: number | null;
  targetFat: number | null;
}

function seriesFor(
  key: BodySeries["key"],
  points: readonly FitnessMetricPoint[],
  domain: Domain | null,
  scale: ChartScale | null,
): BodySeries | null {
  return domain === null || scale === null
    ? null
    : { key, points, domain, scale };
}

/**
 * The chart value on `date`: the series' own point, or the latest point before
 * it when the API's interpolation has not reached that date.
 */
function valueOnDay(
  points: readonly FitnessMetricPoint[],
  date: string,
): BodyTargetPoint | null {
  const point =
    points.find((entry) => entry.date === date) ??
    lastPointOnOrBefore(points, date);
  return point ? { date, value: point.value } : null;
}

/**
 * Shapes the body measurements into one scale per measure and the future diet
 * targets. Returns `null` when the athlete has no body measurements at all.
 */
export function prepareBodyChart(input: BodyChartInput): BodyChartData | null {
  const {
    days,
    weight,
    bodyFat,
    today,
    seasonEndDate = null,
    dietTargets = [],
    showFuture = false,
  } = input;
  const canShowFuture =
    seasonEndDate !== null &&
    seasonEndDate > today &&
    dietTargets.some(
      (target) =>
        target.date > today &&
        (target.weightKg !== null || target.bodyFatPercent !== null),
    );
  const futureEnd = showFuture && canShowFuture ? seasonEndDate : null;
  const lastDay = days[days.length - 1]?.date ?? today;
  const chartDays =
    futureEnd !== null && futureEnd > lastDay
      ? [...days, ...datesAfter(lastDay, futureEnd)]
      : days;
  if (weight.length === 0 && bodyFat.length === 0) {
    return null;
  }

  const weightStart = valueOnDay(weight, today);
  const fatStart = valueOnDay(bodyFat, today);
  const weightTargets =
    futureEnd === null
      ? []
      : dietTargetSeries(dietTargets, "weightKg", weightStart, futureEnd);
  const fatTargets =
    futureEnd === null
      ? []
      : dietTargetSeries(dietTargets, "bodyFatPercent", fatStart, futureEnd);

  const weightDomain =
    weight.length > 0
      ? niceDomain(
          [
            ...weight.map((point) => point.value),
            ...weightTargets.map((point) => point.value),
          ],
          { minSpan: 2 },
        )
      : null;
  const fatDomain =
    bodyFat.length > 0
      ? niceDomain(
          [
            ...bodyFat.map((point) => point.value),
            ...fatTargets.map((point) => point.value),
          ],
          { minSpan: 2 },
        )
      : null;
  const weightScale = weightDomain
    ? chartScale(chartDays.length, weightDomain)
    : null;
  const fatScale = fatDomain ? chartScale(chartDays.length, fatDomain) : null;
  const yScale = weightScale ?? fatScale;
  if (yScale === null) {
    return null;
  }
  const weightSeries = seriesFor("weight", weight, weightDomain, weightScale);
  const fatSeries = seriesFor("body-fat", bodyFat, fatDomain, fatScale);
  const gridDomain = weightDomain ?? fatDomain;
  const dayIndex = new Map(chartDays.map((day, index) => [day.date, index]));
  return {
    chartDays,
    weight: weightSeries,
    bodyFat: fatSeries,
    weightTargets,
    fatTargets,
    yScale,
    ticks: weightDomain === null ? [] : axisTicks(weightDomain),
    gridTicks: gridDomain === null ? [] : axisTicks(gridDomain),
    rightTicks: fatDomain === null ? undefined : axisTicks(fatDomain),
    split: lastIndexOnOrBefore(
      chartDays.map((day) => day.date),
      today,
    ),
    dayIndex,
    canShowFuture,
  };
}

/** The hovered day's measured values and interpolated diet targets. */
export function bodyValuesAt(
  data: BodyChartData,
  date: string | null,
): BodyHoverValues {
  return {
    weight:
      date === null
        ? null
        : (data.weight?.points.find((point) => point.date === date)?.value ??
          null),
    fat:
      date === null
        ? null
        : (data.bodyFat?.points.find((point) => point.date === date)?.value ??
          null),
    targetWeight:
      date === null ? null : dietTargetValueAt(data.weightTargets, date),
    targetFat: date === null ? null : dietTargetValueAt(data.fatTargets, date),
  };
}

/** The body chart's legend: the available measures and the diet target line. */
export function bodyLegendItems(data: BodyChartData): ChartLegendItem[] {
  const items: ChartLegendItem[] = [];
  if (data.weight !== null) {
    items.push({
      key: "weight",
      label: "Weight (kg)",
      swatch: "bg-primary",
      text: null,
    });
  }
  if (data.bodyFat !== null) {
    items.push({
      key: "body-fat",
      label: "Body fat (%)",
      swatch: "bg-chart-ink-muted",
      text: null,
    });
  }
  if (data.weightTargets.length > 0 || data.fatTargets.length > 0) {
    items.push({
      key: "diet-target",
      label: "Estimated diet progress",
      swatchClassName: "h-0 border-t-2 border-dashed border-chart-ink",
      text: null,
    });
  }
  return items;
}
