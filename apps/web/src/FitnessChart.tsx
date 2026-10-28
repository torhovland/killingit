import {
  FORM_INTERPRETATION_LABELS,
  FORM_ZONES,
  type FitnessHistoryDay,
} from "@killingit/shared";
import {
  FORM_FILL_CLASSES,
  FORM_STROKE_CLASSES,
  FORM_SWATCH_CLASSES,
  FORM_TEXT_CLASSES,
} from "./formColors";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  formatZoneRange,
  FUTURE_DASH,
  labelIndices,
  lastIndexOnOrBefore,
  linePath,
  niceDomain,
  tsbSegments,
  zoneBlocks,
} from "./chartGeometry";
import { formatDate } from "./dates";
import { FitnessDayTooltip } from "./FitnessDayTooltip";
import { useChartHover } from "./useChartHover";

/**
 * Fitness (CTL), fatigue (ATL), and form (TSB) over the returned days. The plot
 * is white and the TSB bands are pale tints of the zone colours, so the solid
 * TSB line and its legend stay readable. Pointing at a day shows its numbers
 * and the activities logged that day.
 */
export function FitnessChart({
  days,
  today,
}: {
  days: readonly FitnessHistoryDay[];
  /** The last measured day; later days are the plan's projection. */
  today: string;
}) {
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    days.length,
    (index) => days[index],
  );
  const domain = niceDomain([
    ...days.map((day) => day.ctl),
    ...days.map((day) => day.atl),
    ...days.map((day) => day.tsb),
    -30,
    25,
  ]);
  const scale = chartScale(days.length, domain);
  const xLabels = labelIndices(days.length);
  // Everything after today is a projection, so it is drawn dotted.
  const split = lastIndexOnOrBefore(
    days.map((day) => day.date),
    today,
  );
  const futureStart = Math.max(split, 0);
  const hasFuture = split < days.length - 1;
  const ctl = days.map((day) => day.ctl);
  const atl = days.map((day) => day.atl);

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="text-base font-medium">
        Fitness and form
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label="Fitness (CTL), fatigue (ATL), and form (TSB) chart over the training-stress-balance zones"
          data-testid="fitness-chart"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          <title>{`Fitness, fatigue, and form over the last ${days.length} days`}</title>
          <g
            transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}
          >
            <rect
              x={0}
              y={0}
              width={scale.plotWidth}
              height={scale.plotHeight}
              className="fill-chart-plot"
            />
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
              d={linePath(ctl.slice(0, split + 1), scale)}
              className="fill-none stroke-chart-ink"
              strokeWidth={2.5}
              data-series="ctl"
            />
            <path
              d={linePath(atl.slice(0, split + 1), scale)}
              className="fill-none stroke-chart-ink-muted"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              data-series="atl"
            />
            {hasFuture && (
              <>
                <path
                  d={linePath(ctl.slice(futureStart), scale, futureStart)}
                  className="fill-none stroke-chart-ink"
                  strokeWidth={2.5}
                  strokeDasharray={FUTURE_DASH}
                  data-series="ctl"
                  data-future="true"
                />
                <path
                  d={linePath(atl.slice(futureStart), scale, futureStart)}
                  className="fill-none stroke-chart-ink-muted"
                  strokeWidth={1.5}
                  strokeDasharray={FUTURE_DASH}
                  data-series="atl"
                  data-future="true"
                />
              </>
            )}
            {tsbSegments(
              days.map((day) => day.tsb),
              scale,
            ).map((segment, index) => (
              <line
                key={index}
                x1={segment.from.x}
                y1={segment.from.y}
                x2={segment.to.x}
                y2={segment.to.y}
                className={FORM_STROKE_CLASSES[segment.interpretation]}
                strokeWidth={2}
                {...(segment.index > split
                  ? { strokeDasharray: FUTURE_DASH, "data-future": "true" }
                  : {})}
                data-zone={segment.interpretation}
              />
            ))}
            {hovered !== null && (
              <circle
                cx={hovered.x}
                cy={scale.y(hovered.day.ctl)}
                r={3.5}
                className="fill-chart-ink"
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
              className="fill-muted-foreground text-[10px]"
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
                className="fill-muted-foreground text-[10px]"
              >
                {formatDate(day.date)}
              </text>
            );
          })}
        </svg>
        {hovered !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-56 -translate-x-1/2 rounded border bg-card p-2 text-xs shadow-lg"
            style={{ left: `${hovered.percent}%` }}
          >
            <FitnessDayTooltip day={hovered.day} today={today} />
          </div>
        )}
      </div>
      <ul className={LEGEND_CLASSES} style={{ paddingLeft: LEGEND_INSET }}>
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
      <ul className={LEGEND_CLASSES} style={{ paddingLeft: LEGEND_INSET }}>
        <li className="flex items-center gap-1.5">
          <LineSwatch className="bg-chart-ink" />
          Fitness (CTL)
        </li>
        <li className="flex items-center gap-1.5">
          <LineSwatch className="border-t border-dashed border-chart-ink-muted" />
          Fatigue (ATL)
        </li>
        <li className="flex items-center gap-1.5">
          <LineSwatch className="bg-form-productive-line" />
          Form (TSB)
        </li>
      </ul>
    </figure>
  );
}

/**
 * The legends line up with the plot's left edge rather than the axis gutter:
 * the gutter is `CHART_PADDING.left` of the chart's `CHART_WIDTH` viewBox, and
 * the SVG scales to the figure's width.
 */
const LEGEND_INSET = `${((CHART_PADDING.left / CHART_WIDTH) * 100).toFixed(4)}%`;
const LEGEND_CLASSES = "flex flex-wrap gap-x-4 gap-y-1 text-xs";

/** A line-style legend swatch, drawn on the same white as the plot. */
function LineSwatch({ className }: { className: string }) {
  return (
    <span className="flex h-3 w-6 items-center justify-center rounded-sm bg-chart-plot">
      <span className={`block h-0.5 w-4 ${className}`} />
    </span>
  );
}
