import type { FitnessHistoryResponse } from "@killingit/shared";
import { FitnessChart } from "./FitnessChart";
import { FtpChart } from "./FtpChart";
import { TrainingLoadLine } from "./TrainingLoadLine";

/**
 * The Fitness page content: today's load line, the fitness/form chart with its
 * TSB zone legend, and the estimated-FTP chart.
 */
export function FitnessView({
  history,
  today,
  error,
}: {
  /** Null while the history is loading. */
  history: FitnessHistoryResponse | null;
  today: string;
  error?: string | null;
}) {
  const todayLoad = history?.days.find((day) => day.date === today) ?? null;

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Fitness</h2>
        <p className="text-sm text-muted-foreground">
          How your training load has moved your fitness, fatigue, and form, and
          where the coach expects your FTP to be.
        </p>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}

      {history === null ? (
        !error && <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {todayLoad !== null && (
            <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
              <span className="text-sm font-medium">Today</span>
              <TrainingLoadLine load={todayLoad} testId="fitness-today-load" />
            </div>
          )}

          {history.days.length > 1 ? (
            <FitnessChart days={history.days} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough history yet. Sync your activities or follow the plan
              for a few days and your fitness chart fills in.
            </p>
          )}

          <FtpChart points={history.ftp} />
        </>
      )}
    </section>
  );
}
