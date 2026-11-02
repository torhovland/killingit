import {
  DAILY_HEALTH_METRICS,
  formatDailyHealthValue,
  type DailyHealthMetricKey,
  type DailyHealthPoint,
  type FitnessHistoryDay,
} from "@killingit/shared";
import {
  axisTicks,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  formatChartDate,
  labelIndices,
  niceDomain,
  nullAwarePath,
  type ChartScale,
  type Domain,
} from "./chartGeometry";
import { useChartHover } from "./useChartHover";

interface HealthSeries {
  key: DailyHealthMetricKey;
  label: string;
  values: readonly (number | null)[];
  format: (value: number) => string;
  stroke: string;
  swatch: string;
}

type HealthByDate = Map<string, Map<DailyHealthMetricKey, number>>;

function healthByDate(points: readonly DailyHealthPoint[]): HealthByDate {
  const result: HealthByDate = new Map();
  for (const point of points) {
    const day =
      result.get(point.date) ?? new Map<DailyHealthMetricKey, number>();
    day.set(point.metric, point.value);
    result.set(point.date, day);
  }
  return result;
}

function metricValues(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
  metric: DailyHealthMetricKey,
): (number | null)[] {
  return days.map((day) => byDate.get(day.date)?.get(metric) ?? null);
}

function hasValues(series: readonly HealthSeries[]): boolean {
  return series.some((entry) =>
    entry.values.some((value) => value !== null && value !== undefined),
  );
}

function formatBpm(value: number): string {
  return `${Math.round(value)} bpm`;
}

function formatScore(value: number): string {
  return `${Math.round(value)}`;
}

function formatSleepAxis(value: number): string {
  return `${Math.round(value / 60)}h`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A stacked area segment, breaking wherever a component is missing. */
function stackedAreaPath(
  top: readonly (number | null)[],
  bottom: readonly (number | null)[],
  scale: ChartScale,
): string {
  let path = "";
  let run: number[] = [];
  const flush = (): void => {
    if (run.length === 0) {
      return;
    }
    const forward = run.map(
      (index) => `${round(scale.x(index))} ${round(scale.y(top[index] ?? 0))}`,
    );
    const backward = [...run]
      .reverse()
      .map(
        (index) =>
          `${round(scale.x(index))} ${round(scale.y(bottom[index] ?? 0))}`,
      );
    path += `M${forward.join(" L")} L${backward.join(" L")} Z `;
    run = [];
  };
  for (let index = 0; index < top.length; index += 1) {
    if (top[index] == null || bottom[index] == null) {
      flush();
      continue;
    }
    run.push(index);
  }
  flush();
  return path.trim();
}

/** The chart card shared by the resting-heart-rate and score charts. */
function HealthLineChart({
  title,
  subtitle,
  days,
  series,
  domain,
  formatTick,
}: {
  title: string;
  subtitle?: string;
  days: readonly FitnessHistoryDay[];
  series: readonly HealthSeries[];
  domain: Domain;
  formatTick: (value: number) => string;
}) {
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    days.length,
    (index) => days[index],
  );
  if (!hasValues(series)) {
    return null;
  }
  const scale = chartScale(days.length, domain);
  const xLabels = labelIndices(days.length);
  const hoveredIndex =
    hovered === null
      ? -1
      : days.findIndex((day) => day.date === hovered.day.date);

  return (
    <figure className="relative flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="flex flex-col">
        <span className="text-lg font-medium">{title}</span>
        {subtitle !== undefined && (
          <span className="text-sm text-muted-foreground">{subtitle}</span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title} chart`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <title>{title}</title>
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
          {series.map((entry) => (
            <path
              key={entry.key}
              d={nullAwarePath(entry.values, scale, 0, days.length - 1)}
              className={`fill-none ${entry.stroke}`}
              strokeWidth={2}
              data-series={entry.key}
            />
          ))}
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
            {formatTick(tick)}
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
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-0.5 w-4 ${entry.swatch}`}
              aria-hidden="true"
            />
            <span className="font-medium">{entry.label}</span>
          </li>
        ))}
      </ul>
      {hovered !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-60 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
          style={{ left: `${hovered.percent}%` }}
          data-testid="health-chart-tooltip"
        >
          <p className="text-base font-medium">
            {formatChartDate(hovered.day.date)}
          </p>
          <HealthTooltip
            series={series}
            index={hoveredIndex}
            date={hovered.day.date}
          />
        </div>
      )}
    </figure>
  );
}

function HealthTooltip({
  series,
  index,
  date,
}: {
  series: readonly HealthSeries[];
  index: number;
  date: string;
}) {
  const values = series.flatMap((entry) => {
    const value = index < 0 ? null : entry.values[index];
    return value === null || value === undefined
      ? []
      : [{ label: entry.label, value: entry.format(value) }];
  });
  if (values.length === 0) {
    return <p className="text-muted-foreground">No Garmin data on {date}</p>;
  }
  return (
    <ul className="text-muted-foreground">
      {values.map((entry) => (
        <li key={entry.label}>
          <span className="font-medium text-foreground">{entry.label}</span>{" "}
          {entry.value}
        </li>
      ))}
    </ul>
  );
}

function RestingHeartRateChart({
  days,
  byDate,
}: {
  days: readonly FitnessHistoryDay[];
  byDate: HealthByDate;
}) {
  const values = metricValues(days, byDate, "resting_heart_rate");
  const series: HealthSeries[] = [
    {
      key: "resting_heart_rate",
      label: DAILY_HEALTH_METRICS.resting_heart_rate.label,
      values,
      format: formatBpm,
      stroke: "stroke-primary",
      swatch: "bg-primary",
    },
  ];
  const domain = niceDomain(
    values.filter((value): value is number => value !== null),
    { minSpan: 10 },
  );
  return (
    <HealthLineChart
      title="Resting heart rate"
      subtitle="bpm"
      days={days}
      series={series}
      domain={domain}
      formatTick={(value) => `${Math.round(value)}`}
    />
  );
}

function ScoreChart({
  days,
  byDate,
}: {
  days: readonly FitnessHistoryDay[];
  byDate: HealthByDate;
}) {
  const series: HealthSeries[] = [
    {
      key: "body_battery_high",
      label: DAILY_HEALTH_METRICS.body_battery_high.label,
      values: metricValues(days, byDate, "body_battery_high"),
      format: formatScore,
      stroke: "stroke-form-fresh-line",
      swatch: "bg-form-fresh-line",
    },
    {
      key: "sleep_score",
      label: DAILY_HEALTH_METRICS.sleep_score.label,
      values: metricValues(days, byDate, "sleep_score"),
      format: formatScore,
      stroke: "stroke-primary",
      swatch: "bg-primary",
    },
    {
      key: "stress",
      label: DAILY_HEALTH_METRICS.stress.label,
      values: metricValues(days, byDate, "stress"),
      format: formatScore,
      stroke: "stroke-destructive",
      swatch: "bg-destructive",
    },
  ];
  return (
    <HealthLineChart
      title="Score"
      subtitle="Body Battery high, sleep score and stress"
      days={days}
      series={series}
      domain={{ min: 0, max: 100 }}
      formatTick={(value) => `${Math.round(value)}`}
    />
  );
}

function SleepChart({
  days,
  byDate,
}: {
  days: readonly FitnessHistoryDay[];
  byDate: HealthByDate;
}) {
  const { hovered, onPointerMove, onPointerLeave } = useChartHover(
    days.length,
    (index) => days[index],
  );
  const deep = metricValues(days, byDate, "deep_sleep");
  const light = metricValues(days, byDate, "light_sleep");
  const rem = metricValues(days, byDate, "rem_sleep");
  const awake = metricValues(days, byDate, "awake_sleep");
  const total = days.map((_, index) => {
    const parts = [deep[index], light[index], rem[index]];
    if (parts.every((value) => value === null || value === undefined)) {
      return null;
    }
    return parts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  });
  const totalValues = total.filter(
    (value): value is number => value !== null && value !== undefined,
  );
  if (totalValues.length === 0) {
    return null;
  }
  const domain = {
    min: 0,
    max: Math.max(60, niceDomain(totalValues, { minSpan: 120 }).max),
  };
  const scale = chartScale(days.length, domain);
  const xLabels = labelIndices(days.length);
  const hoveredIndex =
    hovered === null
      ? -1
      : days.findIndex((day) => day.date === hovered.day.date);

  const deepValues = deep.map((value, index) =>
    total[index] === null ? null : (value ?? 0),
  );
  const lightValues = light.map((value, index) =>
    total[index] === null ? null : (value ?? 0),
  );
  const remValues = rem.map((value, index) =>
    total[index] === null ? null : (value ?? 0),
  );
  const deepTop = deepValues;
  const lightTop = deepValues.map((value, index) =>
    value === null ? null : value + (lightValues[index] ?? 0),
  );
  const remTop = lightTop.map((value, index) =>
    value === null ? null : value + (remValues[index] ?? 0),
  );

  const series: HealthSeries[] = [
    {
      key: "deep_sleep",
      label: DAILY_HEALTH_METRICS.deep_sleep.label,
      values: deep,
      format: (value) => formatDailyHealthValue("deep_sleep", value),
      stroke: "stroke-primary",
      swatch: "bg-primary",
    },
    {
      key: "light_sleep",
      label: DAILY_HEALTH_METRICS.light_sleep.label,
      values: light,
      format: (value) => formatDailyHealthValue("light_sleep", value),
      stroke: "stroke-chart-ink-muted",
      swatch: "bg-chart-ink-muted",
    },
    {
      key: "rem_sleep",
      label: DAILY_HEALTH_METRICS.rem_sleep.label,
      values: rem,
      format: (value) => formatDailyHealthValue("rem_sleep", value),
      stroke: "stroke-form-fresh-line",
      swatch: "bg-form-fresh-line",
    },
  ];

  return (
    <figure className="relative flex flex-col gap-2 rounded-lg border bg-card p-4">
      <figcaption className="flex flex-col">
        <span className="text-lg font-medium">Sleep</span>
        <span className="text-sm text-muted-foreground">
          Stacked stages add up to sleep duration.
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Sleep stages chart"
        data-testid="sleep-chart"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <title>Sleep stages</title>
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
          <path
            d={stackedAreaPath(
              deepTop,
              total.map(() => 0),
              scale,
            )}
            className="fill-primary/25 stroke-primary"
            strokeWidth={1}
            data-series="deep_sleep"
          />
          <path
            d={stackedAreaPath(lightTop, deepTop, scale)}
            className="fill-chart-ink-muted/20 stroke-chart-ink-muted"
            strokeWidth={1}
            data-series="light_sleep"
          />
          <path
            d={stackedAreaPath(remTop, lightTop, scale)}
            className="fill-form-fresh/20 stroke-form-fresh-line"
            strokeWidth={1}
            data-series="rem_sleep"
          />
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
            {formatSleepAxis(tick)}
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
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5">
            <span
              className={`inline-block h-3 w-4 ${entry.swatch}`}
              aria-hidden="true"
            />
            <span className="font-medium">{entry.label}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="font-medium">Awake</span>
        </li>
      </ul>
      {hovered !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-60 -translate-x-1/2 rounded border bg-card p-2 text-sm shadow-lg"
          style={{ left: `${hovered.percent}%` }}
          data-testid="sleep-chart-tooltip"
        >
          <p className="text-base font-medium">
            {formatChartDate(hovered.day.date)}
          </p>
          <ul className="text-muted-foreground">
            {series.map((entry) => {
              const value =
                hoveredIndex < 0 ? null : entry.values[hoveredIndex];
              return value === null || value === undefined ? null : (
                <li key={entry.key}>
                  <span className="font-medium text-foreground">
                    {entry.label}
                  </span>{" "}
                  {entry.format(value)}
                </li>
              );
            })}
            {hoveredIndex >= 0 && awake[hoveredIndex] != null && (
              <li>
                <span className="font-medium text-foreground">Awake</span>{" "}
                {formatDailyHealthValue(
                  "awake_sleep",
                  awake[hoveredIndex] ?? 0,
                )}
              </li>
            )}
            {total[hoveredIndex] != null && (
              <li>
                <span className="font-medium text-foreground">
                  Sleep duration
                </span>{" "}
                {formatDailyHealthValue(
                  "sleep_duration",
                  total[hoveredIndex] ?? 0,
                )}
              </li>
            )}
          </ul>
        </div>
      )}
    </figure>
  );
}

/**
 * Recovery and sleep charts on the Fitness page. Each chart hides itself when
 * Garmin has not recorded its measures.
 */
export function DailyHealthCharts({
  days,
  points,
}: {
  days: readonly FitnessHistoryDay[];
  points: readonly DailyHealthPoint[];
}) {
  const byDate = healthByDate(points);
  const metrics = new Set(points.map((point) => point.metric));
  const hasRecovery =
    metrics.has("resting_heart_rate") ||
    metrics.has("body_battery_high") ||
    metrics.has("sleep_score") ||
    metrics.has("stress");
  const hasSleep =
    metrics.has("deep_sleep") ||
    metrics.has("light_sleep") ||
    metrics.has("rem_sleep");
  if (!hasRecovery && !hasSleep) {
    return null;
  }
  return (
    <section className="flex flex-col gap-4" data-testid="daily-health-charts">
      <h3 className="text-lg font-medium">Recovery and sleep</h3>
      {hasRecovery && (
        <div className="grid gap-4 lg:grid-cols-2">
          <RestingHeartRateChart days={days} byDate={byDate} />
          <ScoreChart days={days} byDate={byDate} />
        </div>
      )}
      {hasSleep && <SleepChart days={days} byDate={byDate} />}
    </section>
  );
}
