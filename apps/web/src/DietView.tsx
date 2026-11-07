import {
  DEFAULT_DIET_GOAL,
  type DietDaySummary,
  type DietSummaryResponse,
} from "@killingit/shared";
import { CalorieBalancePanel } from "./CalorieBalancePanel";
import { FoodEntryCard } from "./FoodEntryCard";
import { FormattedText } from "./FormattedText";

/**
 * The presentational Diet page: the coach's goal and weight-trend judgement,
 * today's calories, and every logged meal grouped under its day. Kept separate
 * from the fetching container so it can be rendered and tested without auth.
 */
export function DietView({
  dietAdvice,
  summary,
  today,
  loading,
  error,
  onRetry,
  onOpenSettings,
}: {
  dietAdvice: boolean;
  /** Null while the summary is loading for the first time. */
  summary: DietSummaryResponse | null;
  today: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const todayEntry = summary?.days.find((day) => day.date === today) ?? null;
  const goal = summary?.goal ?? DEFAULT_DIET_GOAL;

  return (
    <section className="flex flex-col gap-4 text-left" data-testid="diet-page">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold">Diet</h2>
        <p className="text-base text-muted-foreground">
          Your diet goal, today's calories, and every meal you have logged.
        </p>
      </div>

      {!dietAdvice && (
        <p className="rounded border bg-inset p-3 text-base">
          Diet advice is off. Turn it on in Settings to log meals and see them
          here.{" "}
          <button
            type="button"
            className="underline hover:no-underline"
            onClick={onOpenSettings}
          >
            Open Settings
          </button>
        </p>
      )}

      {dietAdvice && (
        <>
          <section
            className="flex flex-col gap-2 rounded-lg border bg-card p-4"
            data-testid="diet-goal"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-xl font-semibold">Goal:</h3>
              <p className="text-lg font-medium" data-testid="diet-goal-text">
                {goal}
              </p>
            </div>
            {summary?.assessment != null && (
              <div className="flex flex-col gap-1 text-base">
                <p className="font-medium">Coach's assessment</p>
                <FormattedText
                  text={summary.assessment}
                  className="text-muted-foreground"
                  testId="diet-assessment"
                />
              </div>
            )}
          </section>

          {todayEntry !== null && (
            <CalorieBalancePanel
              neededKcal={todayEntry.neededCaloriesKcal}
              consumedKcal={todayEntry.consumedCaloriesKcal}
              title="Today"
              testId="diet-today-calories"
            />
          )}

          {error && <p className="text-destructive">Error: {error}</p>}

          {error !== null && summary === null && !loading ? (
            <button
              type="button"
              className="self-start rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : loading && summary === null ? (
            <p className="text-base text-muted-foreground">
              Loading your meals…
            </p>
          ) : summary !== null && summary.days.length === 0 ? (
            <p className="text-base text-muted-foreground">
              No meals have been logged yet. Use the food log on the Coach page
              to add one.
            </p>
          ) : (
            <div className="flex flex-col gap-3" data-testid="diet-days">
              {summary?.days.map((day) => (
                <DietDayCard key={day.date} day={day} today={today} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** One day's totals and the meals logged that day. */
function DietDayCard({ day, today }: { day: DietDaySummary; today: string }) {
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-testid="diet-day"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{formatDietDate(day.date)}</h3>
        {day.date === today && (
          <span className="rounded border bg-muted px-2 py-0.5 text-sm">
            Today
          </span>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-base">
        <Stat
          label="Needed"
          value={
            day.neededCaloriesKcal === null
              ? "—"
              : `${day.neededCaloriesKcal} kcal`
          }
        />
        <Stat
          label="Logged"
          value={
            day.consumedCaloriesKcal === null
              ? "Nothing logged"
              : `${day.consumedCaloriesKcal} kcal`
          }
        />
        <Stat label="Balance" value={formatBalance(day.balanceKcal)} />
      </dl>
      {day.entries.length > 0 ? (
        <div className="flex flex-col gap-3">
          {day.entries.map((entry) => (
            <FoodEntryCard key={entry.id} entry={entry} compact />
          ))}
        </div>
      ) : (
        <p className="text-base text-muted-foreground">
          No meals logged this day.
        </p>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** `-320` reads as a deficit, `+180` as a surplus, and null as unknown. */
function formatBalance(balanceKcal: number | null): string {
  if (balanceKcal === null) {
    return "—";
  }
  if (balanceKcal === 0) {
    return "On target";
  }
  return balanceKcal < 0
    ? `${Math.abs(balanceKcal)} kcal deficit`
    : `${balanceKcal} kcal surplus`;
}

function formatDietDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
