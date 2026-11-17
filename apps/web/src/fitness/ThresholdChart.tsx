import {
  formatThresholdNumber,
  formatThresholdValue,
  type FitnessHistoryDay,
  type ThresholdHistorySeries,
} from "@killingit/shared";
import {
  axisTicks,
  chartScale,
  formatChartDate,
  FUTURE_DASH,
  lastIndexOnOrBefore,
  niceDomain,
  nullAwarePath,
  type ChartScale,
} from "../charts/chartGeometry";
import { ChartFrame } from "../charts/ChartFrame";
import { ChartLegend } from "../charts/ChartLegend";
import { seriesClass } from "../charts/seriesClass";
import { cn } from "../components/cn";
import { prepareThresholdSeries } from "./charts/thresholdData";
import { FitnessDayTooltip } from "./FitnessDayTooltip";

interface ThresholdGroup {
  unit: string;
  kind: ThresholdHistorySeries["kind"];
  series: ThresholdHistorySeries[];
}

/**
 * The estimated threshold over the same window, with one line per measure. A
 * measure is grouped by its unit so watts and beats per minute keep honest
 * axes; a sport can have more than one line, such as cycling FTP and threshold
 * heart rate. Each unit gets its own panel under the shared heading, and the
 * y axis carries plain numbers because the legend names the unit.
 */
export function ThresholdChart({
  days,
  series,
  today,
}: {
  days: readonly FitnessHistoryDay[];
  series: readonly ThresholdHistorySeries[];
  /** The last measured day; later days are the plan's projection. */
  today: string;
}) {
  if (series.length === 0 || days.length === 0) {
    return null;
  }

  const groups = groupByUnit(series);

  return (
    <section className="flex flex-col gap-2" data-testid="threshold-chart">
      <h3 className="text-lg font-medium">Estimated threshold</h3>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <ThresholdPanel
            key={group.unit}
            group={group}
            days={days}
            today={today}
          />
        ))}
      </div>
    </section>
  );
}

function ThresholdPanel({
  group,
  days,
  today,
}: {
  group: ThresholdGroup;
  days: readonly FitnessHistoryDay[];
  today: string;
}) {
  const values = group.series.flatMap((entry) =>
    entry.points.map((point) => point.value),
  );
  const domain = niceDomain(values, domainOptions(group.kind));
  const scale = chartScale(days.length, domain);
  const split = lastIndexOnOrBefore(
    days.map((day) => day.date),
    today,
  );
  const lines = prepareThresholdSeries(days, group.series);

  return (
    <ChartFrame
      label={`Estimated threshold in ${group.unit}`}
      svgTitle={`Estimated threshold in ${group.unit}`}
      figureProps={{
        "data-testid": "threshold-panel",
        "data-unit": group.unit,
      }}
      days={days}
      scale={scale}
      ticks={axisTicks(domain)}
      formatTick={(tick) => formatThresholdNumber(tick, group.unit, group.kind)}
      tooltipTestId="threshold-tooltip"
      tooltip={(hovered) => {
        const hoveredValues = lines.flatMap(({ series: entry, byDate }) => {
          const value = byDate.get(hovered.day.date);
          return value === undefined
            ? []
            : [
                {
                  label: `${entry.label} (${entry.sport})`,
                  value: formatThresholdValue(value, entry.unit, entry.kind),
                },
              ];
        });
        return (
          <>
            <p className="text-base font-medium">
              {formatChartDate(hovered.day.date)}
            </p>
            {hoveredValues.length === 0 ? (
              <p className="text-muted-foreground">No threshold on this day</p>
            ) : (
              <ul className="text-muted-foreground">
                {hoveredValues.map((entry) => (
                  <li key={entry.label}>
                    <span className="font-medium text-foreground">
                      {entry.label}
                    </span>{" "}
                    {entry.value}
                  </li>
                ))}
              </ul>
            )}
            <FitnessDayTooltip day={hovered.day} today={today} />
          </>
        );
      }}
      legend={
        <ChartLegend
          items={group.series.map((entry, index) => ({
            key: `${entry.sport}:${entry.measure}`,
            label: entry.label,
            swatch: seriesClass(index)?.background,
            detail: `${entry.sport} · ${entry.unit}`,
            className: "gap-1 items-stretch",
            swatchClassName: "mt-1",
          }))}
        />
      }
    >
      {() =>
        lines.map(({ series: entry, values: lineValues }, index) => (
          <ThresholdLine
            key={`${entry.sport}:${entry.measure}`}
            values={lineValues}
            scale={scale}
            split={split}
            seriesId={`${entry.sport}:${entry.measure}`}
            strokeClass={seriesClass(index)?.stroke}
          />
        ))
      }
    </ChartFrame>
  );
}

/** A threshold line, solid up to today and dotted for the plan's projection. */
function ThresholdLine({
  values,
  scale,
  split,
  seriesId,
  strokeClass,
}: {
  values: readonly (number | null)[];
  scale: ChartScale;
  split: number;
  seriesId: string;
  strokeClass: string | undefined;
}) {
  return (
    <g>
      <path
        d={nullAwarePath(values, scale, 0, split)}
        className={cn("fill-none", strokeClass)}
        strokeWidth={2}
        data-series={seriesId}
      />
      {split < values.length - 1 && (
        <path
          d={nullAwarePath(
            values,
            scale,
            Math.max(split, 0),
            values.length - 1,
          )}
          className={cn("fill-none", strokeClass)}
          strokeWidth={2}
          strokeDasharray={FUTURE_DASH}
          data-series={seriesId}
          data-future="true"
        />
      )}
    </g>
  );
}

function groupByUnit(
  series: readonly ThresholdHistorySeries[],
): ThresholdGroup[] {
  const groups = new Map<string, ThresholdGroup>();
  for (const entry of series) {
    const group = groups.get(entry.unit);
    if (group === undefined) {
      groups.set(entry.unit, {
        unit: entry.unit,
        kind: entry.kind,
        series: [entry],
      });
    } else {
      group.series.push(entry);
    }
  }
  return [...groups.values()];
}

function domainOptions(kind: ThresholdHistorySeries["kind"]): {
  minSpan: number;
} {
  if (kind === "pace") {
    return { minSpan: 20 };
  }
  if (kind === "heart_rate") {
    return { minSpan: 10 };
  }
  return { minSpan: 10 };
}
