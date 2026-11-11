import {
  DEFAULT_DIET_GOAL,
  type DietDaySummary,
  type DietSummaryResponse,
  type FoodEntry,
} from "@killingit/shared";
import { CalorieBalancePanel } from "./CalorieBalancePanel";
import { EditableFoodEntryCard } from "./EditableFoodEntryCard";
import { FormattedText } from "./FormattedText";
import { Button } from "./components/Button";
import { Card } from "./components/Card";

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
  onOpenSurvey,
  onEntryUpdated,
}: {
  dietAdvice: boolean;
  /** Null while the summary is loading for the first time. */
  summary: DietSummaryResponse | null;
  today: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenSettings: () => void;
  onOpenSurvey: () => void;
  /** Called after a meal is edited, so the page reloads its totals. */
  onEntryUpdated: (entry: FoodEntry) => void;
}) {
  const todayEntry = summary?.days.find((day) => day.date === today) ?? null;
  const goal = summary?.goal ?? DEFAULT_DIET_GOAL;
  const goalIsDefault = summary !== null && !summary.goalProvided;

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
          <Button
            type="button"
            variant="linkStrong"
            size="none"
            onClick={onOpenSettings}
          >
            Open Settings
          </Button>
        </p>
      )}

      {dietAdvice && (
        <>
          <Card
            as="section"
            className="flex flex-col gap-2"
            data-testid="diet-goal"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-xl font-semibold">Goal:</h3>
              <p className="text-lg font-medium" data-testid="diet-goal-text">
                {goal}
              </p>
            </div>
            {goalIsDefault && (
              <p
                className="rounded border bg-inset p-3 text-base text-muted-foreground"
                data-testid="diet-default-goal-note"
              >
                This is the default goal. You can provide your own diet goal on
                the Coaching Survey.{" "}
                <Button
                  type="button"
                  variant="linkStrong"
                  size="none"
                  onClick={onOpenSurvey}
                >
                  Open the Coaching Survey
                </Button>
              </p>
            )}
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
          </Card>

          {todayEntry !== null && (
            <CalorieBalancePanel
              neededKcal={todayEntry.neededCaloriesKcal}
              breakdown={todayEntry.calorieBreakdown}
              consumedKcal={todayEntry.consumedCaloriesKcal}
              title="Today"
              testId="diet-today-calories"
            />
          )}

          {error && <p className="text-destructive">Error: {error}</p>}

          {error !== null && summary === null && !loading ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="self-start"
              onClick={onRetry}
            >
              Retry
            </Button>
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
                <DietDayCard
                  key={day.date}
                  day={day}
                  today={today}
                  onEntryUpdated={onEntryUpdated}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** One day's totals and the meals logged that day. */
function DietDayCard({
  day,
  today,
  onEntryUpdated,
}: {
  day: DietDaySummary;
  today: string;
  onEntryUpdated: (entry: FoodEntry) => void;
}) {
  return (
    <Card as="article" className="flex flex-col gap-3" data-testid="diet-day">
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
            <EditableFoodEntryCard
              key={entry.id}
              entry={entry}
              onUpdated={onEntryUpdated}
            />
          ))}
        </div>
      ) : (
        <p className="text-base text-muted-foreground">
          No meals logged this day.
        </p>
      )}
    </Card>
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
