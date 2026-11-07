import { useState } from "react";
import type {
  FitnessDietTarget,
  FitnessHistoryDay,
  FitnessMetricPoint,
} from "@killingit/shared";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  formatChartDate,
  FUTURE_DASH,
  labelIndices,
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
import { useChartHover } from "./useChartHover";

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
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    chartDays.length,
    (index) => chartDays[index],
  );
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
  const xLabels = labelIndices(chartDays.length);
  const split = lastIndexOnOrBefore(
    chartDays.map((day) => day.date),
    today,
  );
  const hoveredWeight =
    hovered === null
      ? null
      : (weight.find((point) => point.date === hovered.day.date)?.value ??
        null);
  const hoveredFat =
    hovered === null
      ? null
      : (bodyFat.find((point) => point.date === hovered.day.date)?.value ??
        null);
  const hoveredTargetWeight =
    hovered === null
      ? null
      : dietTargetValueAt(weightTargets, hovered.day.date);
  const hoveredTargetFat =
    hovered === null ? null : dietTargetValueAt(fatTargets, hovered.day.date);

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-lg font-medium">Body</figcaption>
        {canShowFuture && onShowFutureChange !== undefined && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showFuture}
              onChange={(event) => onShowFutureChange(event.target.checked)}
              data-testid="body-chart-future-toggle"
            />
            Include future dates to the end of the season
          </label>
        )}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label="Body weight and body-fat percentage chart"
          data-testid="body-chart"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          <title>{`Body weight and body fat over ${chartDays.length} days`}</title>
          <g
            transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}
          >
            {weightDomain !== null &&
              axisTicks(weightDomain).map((tick) => (
                <line
                  key={`weight-${tick}`}
                  x1={0}
                  x2={yScale.plotWidth}
                  y1={yScale.y(tick)}
                  y2={yScale.y(tick)}
                  className="stroke-chart-ink-muted/20"
                  strokeWidth={1}
                />
              ))}
            {weightDomain === null &&
              fatDomain !== null &&
              axisTicks(fatDomain).map((tick) => (
                <line
                  key={`fat-grid-${tick}`}
                  x1={0}
                  x2={yScale.plotWidth}
                  y1={yScale.y(tick)}
                  y2={yScale.y(tick)}
                  className="stroke-chart-ink-muted/20"
                  strokeWidth={1}
                />
              ))}
            {hovered !== null && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={0}
                y2={yScale.plotHeight}
                className="stroke-foreground/40"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
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
              hoveredWeight !== null &&
              weightScale !== null && (
                <circle
                  cx={hovered.x}
                  cy={weightScale.y(hoveredWeight)}
                  r={3.5}
                  className="fill-primary"
                />
              )}
            {hovered !== null && hoveredFat !== null && fatScale !== null && (
              <circle
                cx={hovered.x}
                cy={fatScale.y(hoveredFat)}
                r={3.5}
                className="fill-chart-ink-muted"
              />
            )}
          </g>
          {weightDomain !== null &&
            weightScale !== null &&
            axisTicks(weightDomain).map((tick) => (
              <text
                key={`weight-${tick}`}
                x={CHART_PADDING.left - 6}
                y={CHART_PADDING.top + weightScale.y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {tick}
              </text>
            ))}
          {fatDomain !== null &&
            fatScale !== null &&
            axisTicks(fatDomain).map((tick) => (
              <text
                key={`fat-${tick}`}
                x={CHART_PADDING.left + fatScale.plotWidth - 2}
                y={CHART_PADDING.top + fatScale.y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {tick}
              </text>
            ))}
          {xLabels.map((index) => {
            const day = chartDays[index];
            if (day === undefined) {
              return null;
            }
            return (
              <text
                key={day.date}
                x={CHART_PADDING.left + yScale.x(index)}
                y={CHART_PADDING.top + yScale.plotHeight + 14}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === chartDays.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted-foreground text-[10px]"
              >
                {formatChartDate(day.date)}
              </text>
            );
          })}
        </svg>
        {hovered !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-44 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
            style={{ left: `${hovered.percent}%` }}
          >
            <p className="font-medium">{formatChartDate(hovered.day.date)}</p>
            {hoveredWeight !== null && <p>Weight {hoveredWeight} kg</p>}
            {hoveredTargetWeight !== null && (
              <p>Target weight {round(hoveredTargetWeight)} kg</p>
            )}
            {hoveredFat !== null && <p>Body fat {hoveredFat}%</p>}
            {hoveredTargetFat !== null && (
              <p>Target body fat {round(hoveredTargetFat)}%</p>
            )}
            {hoveredWeight === null &&
              hoveredFat === null &&
              hoveredTargetWeight === null &&
              hoveredTargetFat === null && (
                <p className="text-muted-foreground">No measurement</p>
              )}
          </div>
        )}
      </div>
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
    </figure>
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
