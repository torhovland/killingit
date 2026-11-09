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
} from "./chartGeometry";
import { ChartFrame } from "./ChartFrame";
import { FitnessDayTooltip } from "./FitnessDayTooltip";

/** Distinct line classes so several measures in one unit stay readable. */
const SERIES_CLASSES = [
  { stroke: "stroke-primary", background: "bg-primary" },
  { stroke: "stroke-foreground", background: "bg-foreground" },
  {
    stroke: "stroke-form-fresh-line",
    background: "bg-form-fresh-line",
  },
  { stroke: "stroke-destructive", background: "bg-destructive" },
];

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
        const hoveredValues = group.series.flatMap((entry) => {
          const value = entry.points.find(
            (point) => point.date === hovered.day.date,
          );
          return value === undefined
            ? []
            : [
                {
                  label: `${entry.label} (${entry.sport})`,
                  value: formatThresholdValue(
                    value.value,
                    entry.unit,
                    entry.kind,
                  ),
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
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {group.series.map((entry, index) => (
            <li key={`${entry.sport}:${entry.measure}`} className="flex gap-1">
              <span
                className={`mt-1 inline-block h-0.5 w-4 ${SERIES_CLASSES[index % SERIES_CLASSES.length]?.background ?? SERIES_CLASSES[0]?.background}`}
                aria-hidden="true"
              />
              <span className="font-medium">{entry.label}</span>
              <span className="text-muted-foreground">
                {entry.sport} · {entry.unit}
              </span>
            </li>
          ))}
        </ul>
      }
    >
      {() =>
        group.series.map((entry, index) => {
          const seriesValues = days.map((day) => {
            const point = entry.points.find(
              (candidate) => candidate.date === day.date,
            );
            return point?.value ?? null;
          });
          return (
            <g key={`${entry.sport}:${entry.measure}`}>
              <path
                d={nullAwarePath(seriesValues, scale, 0, split)}
                className={`fill-none ${SERIES_CLASSES[index % SERIES_CLASSES.length]?.stroke ?? SERIES_CLASSES[0]?.stroke}`}
                strokeWidth={2}
                data-series={`${entry.sport}:${entry.measure}`}
              />
              {split < days.length - 1 && (
                <path
                  d={nullAwarePath(
                    seriesValues,
                    scale,
                    Math.max(split, 0),
                    days.length - 1,
                  )}
                  className={`fill-none ${SERIES_CLASSES[index % SERIES_CLASSES.length]?.stroke ?? SERIES_CLASSES[0]?.stroke}`}
                  strokeWidth={2}
                  strokeDasharray={FUTURE_DASH}
                  data-series={`${entry.sport}:${entry.measure}`}
                  data-future="true"
                />
              )}
            </g>
          );
        })
      }
    </ChartFrame>
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

/** A path that breaks wherever a series has no value on a day. */
/** Kept for code that imported the old FTP-specific chart name. */
export { ThresholdChart as FtpChart };
