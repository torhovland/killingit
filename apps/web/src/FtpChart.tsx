import type { FtpHistoryPoint } from "@killingit/shared";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  formatChartDate,
  labelIndices,
  niceDomain,
  stepPath,
} from "./chartGeometry";

/**
 * The estimated FTP over the same window. Steps, not a smooth line: the weekly
 * estimate holds for the whole week and changes at the next one.
 */
export function FtpChart({ points }: { points: readonly FtpHistoryPoint[] }) {
  if (points.length === 0) {
    return null;
  }
  const domain = niceDomain(points.map((point) => point.watts));
  const scale = chartScale(points.length, domain);
  const current = points[points.length - 1];
  const xLabels = labelIndices(points.length);

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="text-sm font-medium">
        Estimated FTP{" "}
        {current !== undefined && (
          <span className="font-medium text-foreground">{current.watts} W</span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full overflow-hidden rounded-md"
        role="img"
        aria-label="Estimated FTP chart"
        data-testid="ftp-chart"
      >
        <title>{`Estimated FTP over the last ${points.length} days`}</title>
        <rect
          x={0}
          y={0}
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          className="fill-chart-plot"
        />
        <g transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}>
          {axisTicks(domain).map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={scale.plotWidth}
              y1={scale.y(tick)}
              y2={scale.y(tick)}
              className="stroke-chart-ink-muted/20"
              strokeWidth={0.5}
            />
          ))}
          <path
            d={stepPath(
              points.map((point) => point.watts),
              scale,
            )}
            className="fill-none stroke-chart-ink"
            strokeWidth={2}
          />
        </g>
        {axisTicks(domain).map((tick) => (
          <text
            key={tick}
            x={CHART_PADDING.left - 6}
            y={CHART_PADDING.top + scale.y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-chart-ink-muted text-[10px]"
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
              className="fill-chart-ink-muted text-[10px]"
            >
              {formatChartDate(point.date)}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
