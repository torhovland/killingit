import {
  formatThresholdValue,
  FITNESS_RANGE_LABELS,
  FITNESS_RANGES,
  type FitnessHistoryResponse,
  type FitnessRange,
} from "@killingit/shared";
import { BodyChart } from "./BodyChart";
import { FitnessChart } from "./FitnessChart";
import { ThresholdChart } from "./ThresholdChart";
import { TrainingLoadLine } from "./TrainingLoadLine";

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
          {(todayLoad !== null || todayThresholds.length > 0) && (
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

          <BodyChart
            days={history.days}
            weight={history.body.weight}
            bodyFat={history.body.bodyFat}
            today={today}
          />
        </>
      )}
    </section>
  );
}
