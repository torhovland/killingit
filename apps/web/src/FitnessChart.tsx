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
  labelIndices,
  linePath,
  niceDomain,
  zoneBlocks,
} from "./chartGeometry";

/**
 * Fitness (CTL), fatigue (ATL), and form (TSB) over the returned days. The
 * background is shaded with the same TSB zone colours the interpretation text
 * uses, so the athlete can read where the form line sits.
 */
export function FitnessChart({ days }: { days: readonly FitnessHistoryDay[] }) {
  const domain = niceDomain([
    ...days.map((day) => day.ctl),
    ...days.map((day) => day.atl),
    ...days.map((day) => day.tsb),
    -30,
    25,
  ]);
  const scale = chartScale(days.length, domain);
  const xLabels = labelIndices(days.length);

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="text-sm font-medium">Fitness and form</figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Fitness (CTL), fatigue (ATL), and form (TSB) chart over the training-stress-balance zones"
        data-testid="fitness-chart"
      >
        <title>{`Fitness, fatigue, and form over the last ${days.length} days`}</title>
        <g transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}>
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
              className="stroke-border"
              strokeWidth={0.5}
            />
          ))}
          <path
            d={linePath(
              days.map((day) => day.ctl),
              scale,
            )}
            className="fill-none stroke-foreground"
            strokeWidth={2}
            data-series="ctl"
          />
          <path
            d={linePath(
              days.map((day) => day.atl),
              scale,
            )}
            className="fill-none stroke-muted-foreground"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            data-series="atl"
          />
          <path
            d={linePath(
              days.map((day) => day.tsb),
              scale,
            )}
            className="fill-none stroke-primary"
            strokeWidth={1.5}
            data-series="tsb"
          />
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
              {formatChartDate(day.date)}
            </text>
          );
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-foreground" />
          Fitness (CTL)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" />
          Fatigue (ATL)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-primary" />
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
