import type { FitnessHistoryDay, FitnessMetricPoint } from "@killingit/shared";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  FUTURE_DASH,
  labelIndices,
  lastIndexOnOrBefore,
  niceDomain,
} from "./chartGeometry";
import { formatDate } from "./dates";
import { useChartHover } from "./useChartHover";

/**
 * Body weight and body-fat percentage over the same window as the fitness
 * charts. Weight uses the left axis in kilograms and body fat the right axis in
 * percent, so both trends can share one plot without one hiding the other.
 * Values between measurements are interpolated by the API; the part after
 * today is a best-fit projection and is drawn dotted.
 */
export function BodyChart({
  days,
  weight,
  bodyFat,
  today,
}: {
  days: readonly FitnessHistoryDay[];
  weight: readonly FitnessMetricPoint[];
  bodyFat: readonly FitnessMetricPoint[];
  /** The last measured day; later days are a projection. */
  today: string;
}) {
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    days.length,
    (index) => days[index],
  );
  if (weight.length === 0 && bodyFat.length === 0) {
    return null;
  }

  const weightDomain =
    weight.length > 0
      ? niceDomain(
          weight.map((point) => point.value),
          { minSpan: 2 },
        )
      : null;
  const fatDomain =
    bodyFat.length > 0
      ? niceDomain(
          bodyFat.map((point) => point.value),
          { minSpan: 2 },
        )
      : null;
  const weightScale = weightDomain
    ? chartScale(days.length, weightDomain)
    : null;
  const fatScale = fatDomain ? chartScale(days.length, fatDomain) : null;
  const yScale = weightScale ?? fatScale;
  if (yScale === null) {
    return null;
  }
  const dayIndex = new Map(days.map((day, index) => [day.date, index]));
  const xLabels = labelIndices(days.length);
  const split = lastIndexOnOrBefore(
    days.map((day) => day.date),
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

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="text-base font-medium">Body</figcaption>
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
          <title>{`Body weight and body fat over the last ${days.length} days`}</title>
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
                className="stroke-chart-ink/40"
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
                {tick} kg
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
                {tick}%
              </text>
            ))}
          {xLabels.map((index) => {
            const day = days[index];
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
                    : index === days.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted-foreground text-[10px]"
              >
                {formatDate(day.date)}
              </text>
            );
          })}
        </svg>
        {hovered !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-44 -translate-x-1/2 rounded border bg-card p-2 text-xs shadow-lg"
            style={{ left: `${hovered.percent}%` }}
          >
            <p className="font-medium">{formatDate(hovered.day.date)}</p>
            {hoveredWeight !== null && <p>Weight {hoveredWeight} kg</p>}
            {hoveredFat !== null && <p>Body fat {hoveredFat}%</p>}
            {hoveredWeight === null && hoveredFat === null && (
              <p className="text-muted-foreground">No measurement</p>
            )}
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
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
      </ul>
    </figure>
  );
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
