import type { FitnessHistoryResponse } from "@killingit/shared";
import { FitnessChart } from "./FitnessChart";
import { FtpChart } from "./FtpChart";
import { TrainingLoadLine } from "./TrainingLoadLine";

/**
 * The Fitness page content: today's load line with the current FTP estimate,
 * the fitness/form chart with its TSB zone legend, and the FTP chart.
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
  const todayFtp =
    history?.ftp.find((point) => point.date === today)?.watts ?? null;

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
          {(todayLoad !== null || todayFtp !== null) && (
            <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
              <span className="text-lg font-semibold">Today</span>
              {todayLoad !== null && (
                <TrainingLoadLine
                  load={todayLoad}
                  testId="fitness-today-load"
                  variant="described"
                />
              )}
              {todayFtp !== null && (
                <p
                  className="w-full text-base text-muted-foreground tabular-nums"
                  data-testid="fitness-today-ftp"
                >
                  <span className="font-medium text-foreground">
                    Estimated FTP {todayFtp} W
                  </span>
                </p>
              )}
            </div>
          )}

          {history.days.length > 1 ? (
            <FitnessChart days={history.days} today={today} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough history yet. Sync your activities or follow the plan
              for a few days and your fitness chart fills in.
            </p>
          )}

          <FtpChart days={history.days} points={history.ftp} today={today} />
        </>
      )}
    </section>
  );
}
