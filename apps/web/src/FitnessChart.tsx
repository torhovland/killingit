import { useState, type PointerEvent } from "react";
import {
  FORM_INTERPRETATION_LABELS,
  FORM_ZONES,
  type FitnessHistoryDay,
} from "@killingit/shared";
import {
  FORM_FILL_CLASSES,
  FORM_SWATCH_CLASSES,
  FORM_TEXT_CLASSES,
} from "./formColors";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  formatChartDate,
  formatZoneRange,
  indexAt,
  labelIndices,
  linePath,
  niceDomain,
  zoneBlocks,
} from "./chartGeometry";
import { FitnessDayTooltip } from "./FitnessDayTooltip";

interface HoveredDay {
  day: FitnessHistoryDay;
  /** The day's x position in the plot. */
  x: number;
  /** Where the hover card sits, as a share of the chart's width. */
  percent: number;
}

/**
 * Fitness (CTL), fatigue (ATL), and form (TSB) over the returned days, drawn
 * on a white plot so the TSB zone bands match their legend swatches. Pointing
 * at a day shows its numbers and the activities logged that day.
 */
export function FitnessChart({ days }: { days: readonly FitnessHistoryDay[] }) {
  const [hovered, setHovered] = useState<HoveredDay | null>(null);
  const domain = niceDomain([
    ...days.map((day) => day.ctl),
    ...days.map((day) => day.atl),
    ...days.map((day) => day.tsb),
    -30,
    25,
  ]);
  const scale = chartScale(days.length, domain);
  const xLabels = labelIndices(days.length);

  function handlePointerMove(event: PointerEvent<SVGSVGElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) {
      return;
    }
    // Work in viewBox units so the hover follows the rendered scale.
    const viewX =
      ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH -
      CHART_PADDING.left;
    const index = indexAt(viewX / scale.plotWidth, days.length);
    const day = days[index];
    if (day === undefined) {
      setHovered(null);
      return;
    }
    setHovered({
      day,
      x: scale.x(index),
      // Keep the card inside the chart's edges.
      percent: Math.min(
        80,
        Math.max(
          20,
          ((CHART_PADDING.left + scale.x(index)) / CHART_WIDTH) * 100,
        ),
      ),
    });
  }

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="text-sm font-medium">Fitness and form</figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full overflow-hidden rounded-md"
          role="img"
          aria-label="Fitness (CTL), fatigue (ATL), and form (TSB) chart over the training-stress-balance zones"
          data-testid="fitness-chart"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={() => setHovered(null)}
        >
          <title>{`Fitness, fatigue, and form over the last ${days.length} days`}</title>
          {/* The whole chart sits on white, axis labels included. */}
          <rect
            x={0}
            y={0}
            width={CHART_WIDTH}
            height={CHART_HEIGHT}
            className="fill-chart-plot"
          />
          <g
            transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}
          >
            {zoneBlocks(domain).map(({ zone, from, to }) => (
              <rect
                key={zone.interpretation}
                x={0}
                y={scale.y(to)}
                width={scale.plotWidth}
                height={scale.y(from) - scale.y(to)}
                className={FORM_FILL_CLASSES[zone.interpretation]}
                data-zone={zone.interpretation}
              />
            ))}
            {axisTicks(domain).map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={scale.plotWidth}
                y1={scale.y(tick)}
                y2={scale.y(tick)}
                className="stroke-chart-ink-muted/20"
                strokeWidth={1}
              />
            ))}
            {hovered !== null && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={0}
                y2={scale.plotHeight}
                className="stroke-chart-ink/40"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
            <path
              d={linePath(
                days.map((day) => day.ctl),
                scale,
              )}
              className="fill-none stroke-chart-ink"
              strokeWidth={2.5}
              data-series="ctl"
            />
            <path
              d={linePath(
                days.map((day) => day.atl),
                scale,
              )}
              className="fill-none stroke-chart-ink-muted"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              data-series="atl"
            />
            <path
              d={linePath(
                days.map((day) => day.tsb),
                scale,
              )}
              className="fill-none stroke-chart-ink"
              strokeWidth={1.5}
              strokeDasharray="2 3"
              data-series="tsb"
            />
            {hovered !== null &&
              [hovered.day.ctl, hovered.day.atl, hovered.day.tsb].map(
                (value, series) => (
                  <circle
                    key={series}
                    cx={hovered.x}
                    cy={scale.y(value)}
                    r={3}
                    className="fill-chart-ink"
                  />
                ),
              )}
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
              {Math.round(tick)}
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
                x={CHART_PADDING.left + scale.x(index)}
                y={CHART_PADDING.top + scale.plotHeight + 14}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === days.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-chart-ink-muted text-[10px]"
              >
                {formatChartDate(day.date)}
              </text>
            );
          })}
        </svg>
        {hovered !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-56 -translate-x-1/2 rounded border bg-card p-2 text-xs shadow-lg"
            style={{ left: `${hovered.percent}%` }}
          >
            <FitnessDayTooltip day={hovered.day} />
          </div>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5">
          <LineSwatch className="bg-chart-ink" />
          Fitness (CTL)
        </li>
        <li className="flex items-center gap-1.5">
          <LineSwatch className="border-t border-dashed border-chart-ink-muted" />
          Fatigue (ATL)
        </li>
        <li className="flex items-center gap-1.5">
          <LineSwatch className="border-t border-dotted border-chart-ink" />
          Form (TSB)
        </li>
        {[...FORM_ZONES].reverse().map((zone) => (
          <li
            key={zone.interpretation}
            className="flex items-center gap-1.5"
            data-testid={`form-zone-${zone.interpretation}`}
          >
            <span
              className={`inline-block size-2.5 rounded-sm ${FORM_SWATCH_CLASSES[zone.interpretation]}`}
            />
            <span className={FORM_TEXT_CLASSES[zone.interpretation]}>
              {FORM_INTERPRETATION_LABELS[zone.interpretation]}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatZoneRange(zone)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A line-style legend swatch, drawn on the same white as the plot. */
function LineSwatch({ className }: { className: string }) {
  return (
    <span className="flex h-3 w-6 items-center justify-center rounded-sm bg-chart-plot">
      <span className={`block h-0.5 w-4 ${className}`} />
    </span>
  );
}
