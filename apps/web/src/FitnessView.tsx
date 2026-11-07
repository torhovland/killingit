import {
  DAILY_HEALTH_METRICS,
  formatDailyHealthValue,
  formatThresholdValue,
  FITNESS_RANGE_LABELS,
  FITNESS_RANGES,
  type DailyHealthMetricKey,
  type FitnessHistoryResponse,
  type FitnessRange,
} from "@killingit/shared";
import { BodyChartSection } from "./BodyChart";
import { DailyHealthCharts } from "./DailyHealthCharts";
import { FitnessChart } from "./FitnessChart";
import { NutritionChart } from "./NutritionChart";
import { ThresholdChart } from "./ThresholdChart";
import { TrainingLoadLine } from "./TrainingLoadLine";

interface LatestGarminRow {
  key: string;
  label: string;
  value: string;
  date: string;
}

/** The left-hand list in the Today panel, in display order. */
const LEFT_HEALTH_METRICS: readonly DailyHealthMetricKey[] = [
  "resting_heart_rate",
  "hrv",
  "body_battery_high",
  "body_battery_low",
  "stress",
  "steps",
  "intensity_minutes",
  "active_calories",
  "respiration",
  "spo2",
  "training_readiness",
  "recovery_time",
  "vo2max",
  "vo2max_cycling",
];

/** The right-hand Sleep list in the Today panel, in display order. */
const SLEEP_HEALTH_METRICS: readonly DailyHealthMetricKey[] = [
  "sleep_score",
  "sleep_duration",
  "deep_sleep",
  "rem_sleep",
  "light_sleep",
  "awake_sleep",
];

/** The newest reading for each requested measure, ready for the Today panel. */
function latestHealthRows(
  history: FitnessHistoryResponse,
  metrics: readonly DailyHealthMetricKey[],
  today: string,
): LatestGarminRow[] {
  const latest = new Map(
    history.latestGarmin.dailyHealth.map((point) => [point.metric, point]),
  );
  return metrics.flatMap((metric) => {
    const point = latest.get(metric);
    if (point === undefined) {
      return [];
    }
    return [
      {
        key: metric,
        label: DAILY_HEALTH_METRICS[metric].label,
        value: formatDailyHealthValue(metric, point.value),
        date: point.date === today ? "today" : point.date,
      },
    ];
  });
}

/** The newest Garmin weight, body-fat and FTP measurement, for the Today panel. */
function latestBodyRows(
  history: FitnessHistoryResponse,
  today: string,
): LatestGarminRow[] {
  const rows: LatestGarminRow[] = [];
  const { weight, bodyFat, ftp } = history.latestGarmin;
  const add = (
    key: string,
    label: string,
    value: string,
    date: string,
  ): void => {
    rows.push({ key, label, value, date: date === today ? "today" : date });
  };
  if (weight !== null) {
    add("weight", "Weight", `${weight.value.toFixed(1)} kg`, weight.date);
  }
  if (bodyFat !== null) {
    add("body_fat", "Body fat", `${bodyFat.value.toFixed(1)} %`, bodyFat.date);
  }
  if (ftp !== null) {
    add("ftp", "FTP measurement", `${Math.round(ftp.value)} W`, ftp.date);
  }
  return rows;
}

/**
 * The Fitness page content: today's load line with the current FTP estimate,
 * the range picker, the fitness/form chart with its TSB zone legend, and the
 * FTP chart.
 */
export function FitnessView({
  history,
  today,
  range,
  onRangeChange,
  loading = false,
  error,
}: {
  /** Null while the history is loading for the first time. */
  history: FitnessHistoryResponse | null;
  today: string;
  range: FitnessRange;
  onRangeChange: (range: FitnessRange) => void;
  /** True while a new range is being fetched. */
  loading?: boolean;
  error?: string | null;
}) {
  const todayLoad = history?.days.find((day) => day.date === today) ?? null;
  const todayThresholds =
    history?.thresholds.flatMap((series) => {
      const point = series.points.find((entry) => entry.date === today);
      return point === undefined ? [] : [{ series, value: point.value }];
    }) ?? [];
  const leftRows =
    history === null
      ? []
      : [
          ...latestHealthRows(history, LEFT_HEALTH_METRICS, today),
          ...latestBodyRows(history, today),
        ];
  const sleepRows =
    history === null
      ? []
      : latestHealthRows(history, SLEEP_HEALTH_METRICS, today);

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Fitness</h2>
        <p className="text-base text-muted-foreground">
          How your training load has moved your fitness, fatigue, and form,
          where the coach expects your thresholds to be, and how your body
          weight and body fat are trending.
        </p>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}

      {history === null ? (
        !error && <p className="text-base text-muted-foreground">Loading…</p>
      ) : (
        <>
          {(todayLoad !== null ||
            todayThresholds.length > 0 ||
            leftRows.length > 0 ||
            sleepRows.length > 0) && (
            <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
              <span className="text-xl font-semibold">Today</span>
              {todayLoad !== null && (
                <TrainingLoadLine
                  load={todayLoad}
                  testId="fitness-today-load"
                  variant="described"
                />
              )}
              {todayThresholds.length > 0 && (
                <ul
                  className="flex flex-col gap-0.5 text-lg text-muted-foreground"
                  data-testid="fitness-today-thresholds"
                >
                  {todayThresholds.map(({ series, value }) => (
                    <li key={`${series.sport}:${series.measure}`}>
                      <span className="font-medium text-foreground">
                        {series.label} ({series.sport}){" "}
                        {formatThresholdValue(value, series.unit, series.kind)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {(leftRows.length > 0 || sleepRows.length > 0) && (
                <div className="grid gap-4 border-t pt-2 sm:grid-cols-2">
                  <ul
                    className="flex flex-col gap-0.5 text-base text-muted-foreground"
                    data-testid="fitness-today-garmin-left"
                  >
                    {leftRows.map((row) => (
                      <li key={row.key}>
                        <span>{row.label}</span>{" "}
                        <span className="font-medium text-foreground">
                          {row.value}
                        </span>{" "}
                        <span className="text-sm">({row.date})</span>
                      </li>
                    ))}
                  </ul>
                  {sleepRows.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-lg font-medium">Sleep</span>
                      <ul
                        className="flex flex-col gap-0.5 text-base text-muted-foreground"
                        data-testid="fitness-today-garmin-sleep"
                      >
                        {sleepRows.map((row) => (
                          <li key={row.key}>
                            <span>{row.label}</span>{" "}
                            <span className="font-medium text-foreground">
                              {row.value}
                            </span>{" "}
                            <span className="text-sm">({row.date})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 text-base">
            {loading && (
              <span className="text-muted-foreground" aria-live="polite">
                Updating…
              </span>
            )}
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Show</span>
              <select
                className="rounded border bg-card px-2 py-1"
                value={range}
                onChange={(event) =>
                  onRangeChange(event.target.value as FitnessRange)
                }
              >
                {FITNESS_RANGES.map((entry) => (
                  <option key={entry} value={entry}>
                    {FITNESS_RANGE_LABELS[entry]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {history.days.length > 1 ? (
            <FitnessChart days={history.days} today={today} />
          ) : (
            <p className="text-base text-muted-foreground">
              Not enough history yet. Sync your activities or follow the plan
              for a few days and your fitness chart fills in.
            </p>
          )}

          <ThresholdChart
            days={history.days}
            series={history.thresholds}
            today={today}
          />

          <BodyChartSection
            days={history.days}
            weight={history.body.weight}
            bodyFat={history.body.bodyFat}
            today={today}
            seasonEndDate={history.seasonEndDate}
            dietTargets={history.dietTargets}
          />

          <NutritionChart days={history.nutrition} today={today} />

          <DailyHealthCharts days={history.days} points={history.dailyHealth} />
        </>
      )}
    </section>
  );
}
