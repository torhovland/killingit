import type { FitnessHistoryDay, FtpHistoryPoint } from "@killingit/shared";
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
  stepPath,
} from "./chartGeometry";
import { FitnessDayTooltip } from "./FitnessDayTooltip";
import { useChartHover } from "./useChartHover";

/**
 * The estimated FTP over the same window. Steps, not a smooth line: the weekly
 * estimate holds for the whole week and changes at the next one. Hovering shows
 * the same day card as the fitness chart.
 */
export function FtpChart({
  days,
  points,
  today,
}: {
  days: readonly FitnessHistoryDay[];
  points: readonly FtpHistoryPoint[];
  /** The last measured day; later days are the plan's projection. */
  today: string;
}) {
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    points.length,
    (index) => {
      const point = points[index];
      return point === undefined
        ? undefined
        : days.find((day) => day.date === point.date);
    },
  );
  if (points.length === 0) {
    return null;
  }
  const domain = niceDomain(points.map((point) => point.watts));
  const scale = chartScale(points.length, domain);
  // The part of the estimate after today is a projection, so it is dotted.
  const split = lastIndexOnOrBefore(
    points.map((point) => point.date),
    today,
  );
  const futureStart = Math.max(split, 0);
  const hasFuture = split < points.length - 1;
  const watts = points.map((point) => point.watts);
  const xLabels = labelIndices(points.length);
  const hoveredWatts =
    hovered === null
      ? null
      : (points.find((point) => point.date === hovered.day.date)?.watts ??
        null);

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="text-lg font-medium">Estimated FTP</figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label="Estimated FTP chart"
          data-testid="ftp-chart"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          <title>{`Estimated FTP over the last ${points.length} days`}</title>
          <g
            transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}
          >
            {axisTicks(domain).map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={scale.plotWidth}
                y1={scale.y(tick)}
                y2={scale.y(tick)}
                className="stroke-border"
                strokeWidth={1}
              />
            ))}
            {hovered !== null && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={0}
                y2={scale.plotHeight}
                className="stroke-foreground/40"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
            <path
              d={stepPath(watts.slice(0, split + 1), scale)}
              className="fill-none stroke-primary"
              strokeWidth={2}
              data-series="ftp"
            />
            {hasFuture && (
              <path
                d={stepPath(watts.slice(futureStart), scale, futureStart)}
                className="fill-none stroke-primary"
                strokeWidth={2}
                strokeDasharray={FUTURE_DASH}
                data-series="ftp"
                data-future="true"
              />
            )}
            {hovered !== null && hoveredWatts !== null && (
              <circle
                cx={hovered.x}
                cy={scale.y(hoveredWatts)}
                r={3.5}
                className="fill-primary"
              />
            )}
          </g>
          {axisTicks(domain).map((tick) => (
            <text
              key={tick}
              x={CHART_PADDING.left - 6}
              y={CHART_PADDING.top + scale.y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-xs"
            >
              {Math.round(tick)} W
            </text>
          ))}
          {xLabels.map((index) => {
            const point = points[index];
            if (point === undefined) {
              return null;
            }
            return (
              <text
                key={point.date}
                x={CHART_PADDING.left + scale.x(index)}
                y={CHART_PADDING.top + scale.plotHeight + 14}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === points.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted-foreground text-xs"
              >
                {formatChartDate(point.date)}
              </text>
            );
          })}
        </svg>
        {hovered !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-56 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
            style={{ left: `${hovered.percent}%` }}
          >
            <FitnessDayTooltip
              day={hovered.day}
              today={today}
              ftpWatts={hoveredWatts}
            />
          </div>
        )}
      </div>
    </figure>
  );
}
