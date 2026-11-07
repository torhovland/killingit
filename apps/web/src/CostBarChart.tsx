import { useState, type PointerEvent } from "react";
import { CHART_PADDING, CHART_WIDTH, labelIndices } from "./chartGeometry";
import { COST_SERIES_FILL, COST_SERIES_SWATCH } from "./costColors";
import {
  costAxis,
  costBarIndex,
  formatCostAxis,
  formatCostUsd,
  type CostBucket,
  type CostChartData,
  type CostSeriesTotal,
} from "./costChart";

const CHART_HEIGHT = 280;
const PLOT_WIDTH = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
const PLOT_HEIGHT = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

/**
 * A bar chart of LLM spend where each bar is split into one segment per series:
 * a model or a prompt type. The white plot matches the other charts, and
 * pointing at a bar shows its total, the series split, and the call count.
 */
export function CostBarChart({
  title,
  description,
  data,
  emptyMessage,
  testId,
}: {
  title: string;
  description: string;
  data: CostChartData;
  emptyMessage: string;
  testId: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const axis = costAxis(
    Math.max(0, ...data.buckets.map((bucket) => bucket.totalUsd)),
  );
  const slot = PLOT_WIDTH / Math.max(1, data.buckets.length);
  const barWidth = Math.min(56, Math.max(1, slot * 0.68));
  const xLabels = labelIndices(data.buckets.length, 6);
  const visibleSeries = data.series.filter((series) =>
    data.buckets.some((bucket) =>
      bucket.parts.some(
        (part) => part.series === series.series && part.costUsd > 0,
      ),
    ),
  );
  const hoveredBucket =
    hovered === null ? null : (data.buckets[hovered] ?? null);

  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) {
      return;
    }
    const viewX =
      ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH -
      CHART_PADDING.left;
    const index = costBarIndex(viewX / PLOT_WIDTH, data.buckets.length);
    setHovered(index < 0 ? null : index);
  }

  if (data.totalUsd === 0) {
    return (
      <figure
        className="flex flex-col gap-2 rounded-lg border bg-card p-4"
        data-testid={testId}
      >
        <figcaption className="text-lg font-medium">{title}</figcaption>
        <p className="text-base text-muted-foreground">{emptyMessage}</p>
      </figure>
    );
  }

  return (
    <figure
      className="flex flex-col gap-2 rounded-lg border bg-card p-4"
      data-testid={testId}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-medium">{title}</span>
        <span
          className="text-sm text-muted-foreground"
          data-testid={`${testId}-total`}
        >
          {formatCostUsd(data.totalUsd)} in this period
        </span>
      </figcaption>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}. ${description}`}
          data-testid={`${testId}-svg`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => setHovered(null)}
        >
          <title>{`${title} in USD`}</title>
          <g
            transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}
          >
            <rect
              x={0}
              y={0}
              width={PLOT_WIDTH}
              height={PLOT_HEIGHT}
              className="fill-card"
            />
            {axis.ticks.map((tick) => {
              const y = PLOT_HEIGHT - (tick / axis.max) * PLOT_HEIGHT;
              return (
                <g key={tick}>
                  <line
                    x1={0}
                    x2={PLOT_WIDTH}
                    y1={y}
                    y2={y}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={-6}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {formatCostAxis(tick)}
                  </text>
                </g>
              );
            })}
            {hoveredBucket !== null && (
              <rect
                x={slot * (hovered ?? 0)}
                y={0}
                width={slot}
                height={PLOT_HEIGHT}
                className="fill-foreground/10"
              />
            )}
            {data.buckets.map((bucket, index) => (
              <Bar
                key={bucket.key}
                bucket={bucket}
                index={index}
                slot={slot}
                barWidth={barWidth}
                axisMax={axis.max}
                series={data.series}
              />
            ))}
            {xLabels.map((index) => {
              const bucket = data.buckets[index];
              if (bucket === undefined) {
                return null;
              }
              return (
                <text
                  key={bucket.key}
                  x={slot * index + slot / 2}
                  y={PLOT_HEIGHT + 14}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === data.buckets.length - 1
                        ? "end"
                        : "middle"
                  }
                  className="fill-muted-foreground text-[10px]"
                >
                  {bucket.label}
                </text>
              );
            })}
          </g>
        </svg>
        {hoveredBucket !== null && (
          <CostTooltip
            bucket={hoveredBucket}
            series={data.series}
            left={`${((CHART_PADDING.left + slot * (hovered ?? 0) + slot / 2) / CHART_WIDTH) * 100}%`}
          />
        )}
      </div>
      {visibleSeries.length > 0 && (
        <ul
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
          style={{
            paddingLeft: `${((CHART_PADDING.left / CHART_WIDTH) * 100).toFixed(4)}%`,
          }}
          data-testid={`${testId}-legend`}
        >
          {visibleSeries.map((series) => (
            <li key={series.series} className="flex items-center gap-1.5">
              <span
                className={`inline-block size-2.5 rounded-sm ${
                  COST_SERIES_SWATCH[
                    data.series.indexOf(series) % COST_SERIES_SWATCH.length
                  ]
                }`}
              />
              <span>{series.label}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function Bar({
  bucket,
  index,
  slot,
  barWidth,
  axisMax,
  series,
}: {
  bucket: CostBucket;
  index: number;
  slot: number;
  barWidth: number;
  axisMax: number;
  series: readonly CostSeriesTotal[];
}) {
  let cumulative = 0;
  return (
    <g data-bucket={bucket.key} data-testid="cost-bar">
      {series.map((entry) => {
        const part = bucket.parts.find((item) => item.series === entry.series);
        if (part === undefined || part.costUsd <= 0) {
          return null;
        }
        const height = (part.costUsd / axisMax) * PLOT_HEIGHT;
        const y = PLOT_HEIGHT - cumulative - height;
        cumulative += height;
        return (
          <rect
            key={entry.series}
            x={slot * index + (slot - barWidth) / 2}
            y={y}
            width={barWidth}
            height={height}
            className={
              COST_SERIES_FILL[series.indexOf(entry) % COST_SERIES_FILL.length]
            }
            data-series={entry.series}
          >
            <title>{`${entry.label}: ${formatCostUsd(part.costUsd)}`}</title>
          </rect>
        );
      })}
    </g>
  );
}

function CostTooltip({
  bucket,
  series: totals,
  left,
}: {
  bucket: CostBucket;
  series: readonly CostSeriesTotal[];
  left: string;
}) {
  const parts = [...bucket.parts]
    .filter((part) => part.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd);
  const calls = bucket.parts.reduce((sum, part) => sum + part.calls, 0);
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 w-60 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
      style={{ left }}
      data-testid="cost-tooltip"
    >
      <p className="font-medium">{bucket.title}</p>
      <p className="text-muted-foreground">
        {formatCostUsd(bucket.totalUsd)}
        {calls > 0 && ` · ${calls} call${calls === 1 ? "" : "s"}`}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {parts.map((part) => {
          const entry = totals.find((item) => item.series === part.series);
          const index = entry === undefined ? -1 : totals.indexOf(entry);
          return (
            <li
              key={part.series}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`inline-block size-2.5 shrink-0 rounded-sm ${
                    COST_SERIES_SWATCH[
                      Math.max(0, index) % COST_SERIES_SWATCH.length
                    ]
                  }`}
                />
                <span className="truncate">{entry?.label ?? part.series}</span>
              </span>
              <span className="shrink-0">{formatCostUsd(part.costUsd)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
