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
} from "../formColors";
import {
  axisTicks,
  chartScale,
  FUTURE_DASH,
  lastIndexOnOrBefore,
  linePath,
  niceDomain,
  tsbSegments,
  zoneBlocks,
} from "../charts/chartGeometry";
import { CHART_LEGEND_INSET_CLASS, ChartLegend } from "../charts/ChartLegend";
import { ChartFrame } from "../charts/ChartFrame";
import { FitnessDayTooltip } from "./FitnessDayTooltip";

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
  const domain = niceDomain([
    ...days.map((day) => day.ctl),
    ...days.map((day) => day.atl),
    ...days.map((day) => day.tsb),
    -30,
    25,
  ]);
  const scale = chartScale(days.length, domain);
  const ticks = axisTicks(domain);
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
    <ChartFrame
      title="Fitness and form"
      label="Fitness (CTL), fatigue (ATL), and form (TSB) chart over the training-stress-balance zones"
      svgTitle={`Fitness, fatigue, and form over the last ${days.length} days`}
      svgTestId="fitness-chart"
      days={days}
      scale={scale}
      ticks={ticks}
      formatTick={(value) => `${Math.round(value)}`}
      gridClassName="stroke-chart-ink-muted/20"
      hoverLineClassName="stroke-chart-ink/40"
      tooltipClassName="w-56"
      tooltip={(hovered) => (
        <FitnessDayTooltip day={hovered.day} today={today} />
      )}
      legend={
        <>
          <ChartLegend
            className={CHART_LEGEND_INSET_CLASS}
            items={[...FORM_ZONES].reverse().map((zone) => ({
              key: zone.interpretation,
              label: FORM_INTERPRETATION_LABELS[zone.interpretation],
              swatch: FORM_SWATCH_CLASSES[zone.interpretation],
              swatchShape: "square",
              text: FORM_TEXT_CLASSES[zone.interpretation],
              testId: `form-zone-${zone.interpretation}`,
            }))}
          />
          <ChartLegend
            className={CHART_LEGEND_INSET_CLASS}
            items={[
              {
                key: "ctl",
                label: "Fitness (CTL)",
                swatch: "bg-chart-ink",
                swatchShape: "plot-line",
                text: null,
              },
              {
                key: "atl",
                label: "Fatigue (ATL)",
                swatch: "border-t border-dashed border-chart-ink-muted",
                swatchShape: "plot-line",
                text: null,
              },
              {
                key: "tsb",
                label: "Form (TSB)",
                swatch: "bg-form-productive-line",
                swatchShape: "plot-line",
                text: null,
              },
            ]}
          />
        </>
      }
    >
      {(hovered) => (
        <>
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
        </>
      )}
    </ChartFrame>
  );
}
