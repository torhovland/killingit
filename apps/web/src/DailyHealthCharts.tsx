import {
  DAILY_HEALTH_METRICS,
  formatDailyHealthValue,
  type DailyHealthMetricKey,
  type DailyHealthPoint,
  type FitnessHistoryDay,
} from "@killingit/shared";
import {
  axisTicks,
  chartScale,
  formatChartDate,
  niceDomain,
  nullAwarePath,
  type ChartScale,
  type Domain,
} from "./chartGeometry";
import { ChartFrame } from "./ChartFrame";

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
  if (!hasValues(series)) {
    return null;
  }
  const scale = chartScale(days.length, domain);
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      label={`${title} chart`}
      svgTitle={title}
      days={days}
      scale={scale}
      ticks={axisTicks(domain)}
      formatTick={formatTick}
      tooltipTestId="health-chart-tooltip"
      tooltip={(hovered) => {
        const index = days.findIndex((day) => day.date === hovered.day.date);
        return (
          <>
            <p className="text-base font-medium">
              {formatChartDate(hovered.day.date)}
            </p>
            <HealthTooltip
              series={series}
              index={index}
              date={hovered.day.date}
            />
          </>
        );
      }}
      legend={
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
      }
    >
      {() =>
        series.map((entry) => (
          <path
            key={entry.key}
            d={nullAwarePath(entry.values, scale, 0, days.length - 1)}
            className={`fill-none ${entry.stroke}`}
            strokeWidth={2}
            data-series={entry.key}
          />
        ))
      }
    </ChartFrame>
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

interface SleepLayer {
  key: DailyHealthMetricKey;
  className: string;
  top: (number | null)[];
  bottom: (number | null)[];
}

interface SleepChartData {
  series: HealthSeries[];
  layers: SleepLayer[];
  awake: (number | null)[];
  total: (number | null)[];
  domain: Domain;
}

/**
 * The stacked sleep-stage series. A missing stage counts as zero inside a night
 * that has other stages, while a night with no sleep at all stays blank.
 */
function sleepData(
  days: readonly FitnessHistoryDay[],
  byDate: HealthByDate,
): SleepChartData | null {
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
  const zeroFilled = (values: readonly (number | null)[]) =>
    values.map((value, index) => (total[index] === null ? null : (value ?? 0)));
  const deepValues = zeroFilled(deep);
  const lightValues = zeroFilled(light);
  const remValues = zeroFilled(rem);
  const lightTop = deepValues.map((value, index) =>
    value === null ? null : value + (lightValues[index] ?? 0),
  );
  const remTop = lightTop.map((value, index) =>
    value === null ? null : value + (remValues[index] ?? 0),
  );
  return {
    domain,
    awake,
    total,
    series: [
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
    ],
    layers: [
      {
        key: "deep_sleep",
        className: "fill-primary/25 stroke-primary",
        top: deepValues,
        bottom: total.map(() => 0),
      },
      {
        key: "light_sleep",
        className: "fill-chart-ink-muted/20 stroke-chart-ink-muted",
        top: lightTop,
        bottom: deepValues,
      },
      {
        key: "rem_sleep",
        className: "fill-form-fresh/20 stroke-form-fresh-line",
        top: remTop,
        bottom: lightTop,
      },
    ],
  };
}

function SleepChart({
  days,
  byDate,
}: {
  days: readonly FitnessHistoryDay[];
  byDate: HealthByDate;
}) {
  const data = sleepData(days, byDate);
  if (data === null) {
    return null;
  }
  const scale = chartScale(days.length, data.domain);
  return (
    <ChartFrame
      title="Sleep"
      subtitle="Stacked stages add up to sleep duration."
      label="Sleep stages chart"
      svgTitle="Sleep stages"
      svgTestId="sleep-chart"
      days={days}
      scale={scale}
      ticks={axisTicks(data.domain)}
      formatTick={formatSleepAxis}
      tooltipTestId="sleep-chart-tooltip"
      tooltip={(hovered) => {
        const index = days.findIndex((day) => day.date === hovered.day.date);
        return (
          <>
            <p className="text-base font-medium">
              {formatChartDate(hovered.day.date)}
            </p>
            <ul className="text-muted-foreground">
              {data.series.map((entry) => {
                const value = index < 0 ? null : entry.values[index];
                return value === null || value === undefined ? null : (
                  <li key={entry.key}>
                    <span className="font-medium text-foreground">
                      {entry.label}
                    </span>{" "}
                    {entry.format(value)}
                  </li>
                );
              })}
              {index >= 0 && data.awake[index] != null && (
                <li>
                  <span className="font-medium text-foreground">Awake</span>{" "}
                  {formatDailyHealthValue(
                    "awake_sleep",
                    data.awake[index] ?? 0,
                  )}
                </li>
              )}
              {data.total[index] != null && (
                <li>
                  <span className="font-medium text-foreground">
                    Sleep duration
                  </span>{" "}
                  {formatDailyHealthValue(
                    "sleep_duration",
                    data.total[index] ?? 0,
                  )}
                </li>
              )}
            </ul>
          </>
        );
      }}
      legend={
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {data.series.map((entry) => (
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
      }
    >
      {() =>
        data.layers.map((layer) => (
          <path
            key={layer.key}
            d={stackedAreaPath(layer.top, layer.bottom, scale)}
            className={layer.className}
            strokeWidth={1}
            data-series={layer.key}
          />
        ))
      }
    </ChartFrame>
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
