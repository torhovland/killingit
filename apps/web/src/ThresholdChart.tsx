import {
  formatThresholdValue,
  type FitnessHistoryDay,
  type ThresholdHistorySeries,
} from "@killingit/shared";
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
} from "./chartGeometry";
import { FitnessDayTooltip } from "./FitnessDayTooltip";
import { useChartHover } from "./useChartHover";

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
 * heart rate.
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
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    days.length,
    (index) => days[index],
  );
  if (series.length === 0 || days.length === 0) {
    return null;
  }

  const groups = groupByUnit(series);
  const hoverDate = hovered?.day.date ?? null;
  const hoveredValues =
    hoverDate === null
      ? []
      : series.flatMap((entry) => {
          const value = entry.points.find((point) => point.date === hoverDate);
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
    <figure
      className="relative flex flex-col gap-2 rounded-lg border bg-card p-4"
      data-testid="threshold-chart"
    >
      <figcaption className="text-lg font-medium">
        Estimated threshold
      </figcaption>
      {groups.map((group) => (
        <ThresholdPanel
          key={group.unit}
          group={group}
          days={days}
          today={today}
          hovered={hovered}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      ))}
      {hovered !== null && (
        <div
          className="pointer-events-none absolute z-10 w-60 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
          style={{
            left: `${hovered.percent}%`,
            top: "3rem",
          }}
          data-testid="threshold-tooltip"
        >
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
        </div>
      )}
    </figure>
  );
}

function ThresholdPanel({
  group,
  days,
  today,
  hovered,
  onPointerMove,
  onPointerLeave,
}: {
  group: ThresholdGroup;
  days: readonly FitnessHistoryDay[];
  today: string;
  hovered: ReturnType<typeof useChartHover>["hovered"];
  onPointerMove: ReturnType<typeof useChartHover>["onPointerMove"];
  onPointerLeave: ReturnType<typeof useChartHover>["onPointerLeave"];
}) {
  const values = group.series.flatMap((entry) =>
    entry.points.map((point) => point.value),
  );
  const domain = niceDomain(values, domainOptions(group.kind));
  const scale = chartScale(days.length, domain);
  const xLabels = labelIndices(days.length);

  return (
    <div className="relative flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Estimated threshold in ${group.unit}`}
        data-unit={group.unit}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <title>{`Estimated threshold in ${group.unit}`}</title>
        <g transform={`translate(${CHART_PADDING.left} ${CHART_PADDING.top})`}>
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
          {group.series.map((entry, index) => {
            const seriesValues = days.map((day) => {
              const point = entry.points.find(
                (candidate) => candidate.date === day.date,
              );
              return point?.value ?? null;
            });
            const split = lastIndexOnOrBefore(
              days.map((day) => day.date),
              today,
            );
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
          })}
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
            {formatThresholdValue(tick, group.unit, group.kind)}
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
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {group.series.map((entry, index) => {
          const latest = entry.points[entry.points.length - 1];
          return (
            <li key={`${entry.sport}:${entry.measure}`} className="flex gap-1">
              <span
                className={`mt-1 inline-block h-0.5 w-4 ${SERIES_CLASSES[index % SERIES_CLASSES.length]?.background ?? SERIES_CLASSES[0]?.background}`}
                aria-hidden="true"
              />
              <span className="font-medium">{entry.label}</span>
              <span className="text-muted-foreground">
                {entry.sport}
                {latest === undefined
                  ? ""
                  : ` · ${formatThresholdValue(latest.value, entry.unit, entry.kind)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
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
function nullAwarePath(
  values: readonly (number | null)[],
  scale: ReturnType<typeof chartScale>,
  start: number,
  end: number,
): string {
  let path = "";
  let open = false;
  for (let index = start; index <= end; index += 1) {
    const value = values[index];
    if (value === null || value === undefined) {
      open = false;
      continue;
    }
    path += `${open ? "L" : "M"}${round(scale.x(index))} ${round(scale.y(value))} `;
    open = true;
  }
  return path.trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Kept for code that imported the old FTP-specific chart name. */
export { ThresholdChart as FtpChart };
