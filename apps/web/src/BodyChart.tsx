import { useState } from "react";
import type {
  FitnessDietTarget,
  FitnessHistoryDay,
  FitnessMetricPoint,
} from "@killingit/shared";
import {
  axisTicks,
  chartScale,
  formatChartDate,
  FUTURE_DASH,
  lastIndexOnOrBefore,
  niceDomain,
} from "./chartGeometry";
import {
  datesAfter,
  dietTargetSeries,
  dietTargetValueAt,
  lastPointOnOrBefore,
  type BodyTargetPoint,
} from "./bodyProjection";
import { ChartFrame } from "./ChartFrame";

/** The dotted dash of the coach's target line, longer than the best-fit one. */
const TARGET_DASH = "5 4";

/** The Body chart's inputs, shared by the pure chart and its toggle wrapper. */
export interface BodyChartProps {
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
  /** Selects the season view. */
  onShowFutureChange?: (show: boolean) => void;
}

/**
 * Body weight and body-fat percentage over the same window as the fitness
 * charts. Weight uses the left axis and body fat the right axis, so both trends
 * can share one plot without one hiding the other; each axis shows plain
 * numbers because the legend names its unit. Values between measurements are
 * interpolated by the API; the part after today is a best-fit projection and is
 * drawn dotted. When the athlete chooses the season view, the coach's diet
 * targets are drawn as a second dotted line with markers.
 */
export function BodyChart({
  days,
  weight,
  bodyFat,
  today,
  seasonEndDate = null,
  dietTargets = [],
  showFuture = false,
  onShowFutureChange,
}: BodyChartProps) {
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
  const dayIndex = new Map(chartDays.map((day, index) => [day.date, index]));
  const split = lastIndexOnOrBefore(
    chartDays.map((day) => day.date),
    today,
  );
  const hoveredValues = (date: string | null) => ({
    weight:
      date === null
        ? null
        : (weight.find((point) => point.date === date)?.value ?? null),
    fat:
      date === null
        ? null
        : (bodyFat.find((point) => point.date === date)?.value ?? null),
    targetWeight: date === null ? null : dietTargetValueAt(weightTargets, date),
    targetFat: date === null ? null : dietTargetValueAt(fatTargets, date),
  });

  return (
    <ChartFrame
      title="Body"
      label="Body weight and body-fat percentage chart"
      svgTitle={`Body weight and body fat over ${chartDays.length} days`}
      svgTestId="body-chart"
      days={chartDays}
      scale={yScale}
      ticks={weightDomain === null ? [] : axisTicks(weightDomain)}
      gridTicks={
        weightDomain !== null
          ? axisTicks(weightDomain)
          : fatDomain === null
            ? []
            : axisTicks(fatDomain)
      }
      gridClassName="stroke-chart-ink-muted/20"
      rightTicks={fatDomain === null ? undefined : axisTicks(fatDomain)}
      rightScale={fatScale ?? undefined}
      tooltipClassName="w-44"
      headerAction={
        canShowFuture && onShowFutureChange !== undefined ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showFuture}
              onChange={(event) => onShowFutureChange(event.target.checked)}
              data-testid="body-chart-future-toggle"
            />
            Include future dates to the end of the season
          </label>
        ) : undefined
      }
      tooltip={(hovered) => {
        const values = hoveredValues(hovered.day.date);
        return (
          <>
            <p className="font-medium">{formatChartDate(hovered.day.date)}</p>
            {values.weight !== null && <p>Weight {values.weight} kg</p>}
            {values.targetWeight !== null && (
              <p>Target weight {round(values.targetWeight)} kg</p>
            )}
            {values.fat !== null && <p>Body fat {values.fat}%</p>}
            {values.targetFat !== null && (
              <p>Target body fat {round(values.targetFat)}%</p>
            )}
            {values.weight === null &&
              values.fat === null &&
              values.targetWeight === null &&
              values.targetFat === null && (
                <p className="text-muted-foreground">No measurement</p>
              )}
          </>
        );
      }}
      legend={
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {weight.length > 0 && (
            <li className="flex items-center gap-1.5">
              <span className="block h-0.5 w-4 bg-primary" />
              Weight (kg)
            </li>
          )}
          {bodyFat.length > 0 && (
            <li className="flex items-center gap-1.5">
              <span className="block h-0.5 w-4 bg-chart-ink-muted" />
              Body fat (%)
            </li>
          )}
          {(weightTargets.length > 0 || fatTargets.length > 0) && (
            <li className="flex items-center gap-1.5">
              <span className="block w-4 border-t-2 border-dashed border-chart-ink" />
              Estimated diet progress
            </li>
          )}
        </ul>
      }
    >
      {(hovered) => {
        const values = hoveredValues(hovered?.day.date ?? null);
        return (
          <>
            {weightScale !== null && (
              <>
                <path
                  d={metricPath(weight, dayIndex, weightScale, split, "past")}
                  className="fill-none stroke-primary"
                  strokeWidth={2.5}
                  data-series="weight"
                />
                <path
                  d={metricPath(weight, dayIndex, weightScale, split, "future")}
                  className="fill-none stroke-primary"
                  strokeWidth={2.5}
                  strokeDasharray={FUTURE_DASH}
                  data-series="weight"
                  data-future="true"
                />
              </>
            )}
            {fatScale !== null && (
              <>
                <path
                  d={metricPath(bodyFat, dayIndex, fatScale, split, "past")}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  data-series="body-fat"
                />
                <path
                  d={metricPath(bodyFat, dayIndex, fatScale, split, "future")}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  strokeDasharray={FUTURE_DASH}
                  data-series="body-fat"
                  data-future="true"
                />
              </>
            )}
            {weightScale !== null && weightTargets.length > 0 && (
              <>
                <path
                  d={targetPath(weightTargets, dayIndex, weightScale)}
                  className="fill-none stroke-chart-ink"
                  strokeWidth={2}
                  strokeDasharray={TARGET_DASH}
                  data-series="diet-target-weight"
                />
                {weightTargets.slice(1).map((point) => (
                  <circle
                    key={`weight-target-${point.date}`}
                    cx={weightScale.x(dayIndex.get(point.date) ?? 0)}
                    cy={weightScale.y(point.value)}
                    r={2.5}
                    className="fill-chart-ink"
                    data-target-date={point.date}
                  />
                ))}
              </>
            )}
            {fatScale !== null && fatTargets.length > 0 && (
              <>
                <path
                  d={targetPath(fatTargets, dayIndex, fatScale)}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  strokeDasharray={TARGET_DASH}
                  data-series="diet-target-body-fat"
                />
                {fatTargets.slice(1).map((point) => (
                  <circle
                    key={`fat-target-${point.date}`}
                    cx={fatScale.x(dayIndex.get(point.date) ?? 0)}
                    cy={fatScale.y(point.value)}
                    r={2.5}
                    className="fill-chart-ink-muted"
                    data-target-date={point.date}
                  />
                ))}
              </>
            )}
            {hovered !== null &&
              values.weight !== null &&
              weightScale !== null && (
                <circle
                  cx={hovered.x}
                  cy={weightScale.y(values.weight)}
                  r={3.5}
                  className="fill-primary"
                />
              )}
            {hovered !== null && values.fat !== null && fatScale !== null && (
              <circle
                cx={hovered.x}
                cy={fatScale.y(values.fat)}
                r={3.5}
                className="fill-chart-ink-muted"
              />
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}

/**
 * The Body chart with its season-view toggle. Kept separate so the chart itself
 * stays controlled and easy to render in tests.
 */
export function BodyChartSection(
  props: Omit<BodyChartProps, "showFuture" | "onShowFutureChange">,
) {
  const [showFuture, setShowFuture] = useState(false);
  return (
    <BodyChart
      {...props}
      showFuture={showFuture}
      onShowFutureChange={setShowFuture}
    />
  );
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
 * A path through the target points, which all fall on or after today. The
 * points may be sparse, so the segments between periods are straight.
 */
function targetPath(
  points: readonly BodyTargetPoint[],
  dayIndex: ReadonlyMap<string, number>,
  scale: ReturnType<typeof chartScale>,
): string {
  const commands: string[] = [];
  for (const point of points) {
    const index = dayIndex.get(point.date);
    if (index === undefined) {
      continue;
    }
    commands.push(
      `${commands.length === 0 ? "M" : "L"}${round(scale.x(index))} ${round(
        scale.y(point.value),
      )}`,
    );
  }
  return commands.join(" ");
}

/**
 * A path through the days with a value, split before and after today. The
 * series may start after the window's first day, so the path is built from the
 * real day index rather than the point's position in its own array.
 */
function metricPath(
  points: readonly FitnessMetricPoint[],
  dayIndex: ReadonlyMap<string, number>,
  scale: ReturnType<typeof chartScale>,
  split: number,
  part: "past" | "future",
): string {
  const commands: string[] = [];
  for (const point of points) {
    const index = dayIndex.get(point.date);
    if (index === undefined) {
      continue;
    }
    const inPart =
      part === "future" ? split < 0 || index >= split : index <= split;
    if (!inPart) {
      continue;
    }
    commands.push(
      `${commands.length === 0 ? "M" : "L"}${round(scale.x(index))} ${round(
        scale.y(point.value),
      )}`,
    );
  }
  return commands.join(" ");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
