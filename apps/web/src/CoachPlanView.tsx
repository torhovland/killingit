import { useState } from "react";
import type {
  BlockPlan,
  CoachPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
  WeekSessionStatus,
} from "@killingit/shared";
import { WeatherSummary } from "./WeatherSummary";

export type PlanTab = "day" | "week" | "block" | "season";

const TABS: Array<{ id: PlanTab; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "block", label: "Block" },
  { id: "season", label: "Season" },
];

/**
 * Presentational four-level plan in a tabbed view. Day is the default tab and
 * shows today's session plus tomorrow's after 18:00. Kept separate from the
 * fetching/progress container so it can be rendered and tested without auth.
 */
export function CoachPlanView({
  plan,
  showTomorrow = false,
  defaultTab = "day",
  refreshingDays = {},
}: {
  plan: CoachPlan;
  showTomorrow?: boolean;
  defaultTab?: PlanTab;
  /** Days whose stored content is being replaced by a generation in flight. */
  refreshingDays?: { today?: boolean; tomorrow?: boolean };
}) {
  const [tab, setTab] = useState<PlanTab>(defaultTab);

  return (
    <div className="flex flex-col gap-4" data-testid="coach-plan-view">
      <div
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label="Plan levels"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className="rounded border bg-card px-3 py-1 text-sm aria-[selected=true]:border-transparent aria-[selected=true]:bg-primary aria-[selected=true]:text-primary-foreground"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "day" && (
          <div className="flex flex-col gap-4">
            <DayCard
              day={plan.today}
              label="Today"
              testId="plan-today"
              refreshing={refreshingDays.today ?? false}
            />
            {showTomorrow && plan.tomorrow && (
              <DayCard
                day={plan.tomorrow}
                label="Tomorrow"
                testId="plan-tomorrow"
                refreshing={refreshingDays.tomorrow ?? false}
              />
            )}
          </div>
        )}
        {tab === "week" && (
          <div className="flex flex-col gap-4">
            <WeekSection week={plan.week} label="This week" />
            {plan.nextWeek !== null && (
              <WeekSection
                week={plan.nextWeek}
                label="Next week"
                testId="plan-next-week"
              />
            )}
          </div>
        )}
        {tab === "block" && (
          <div className="flex flex-col gap-4">
            <BlockSection block={plan.block} label="Current block" />
            {plan.nextBlock !== null && (
              <BlockSection
                block={plan.nextBlock}
                label="Next block"
                testId="plan-next-block"
              />
            )}
          </div>
        )}
        {tab === "season" && <SeasonSection season={plan.season} />}
      </div>
    </div>
  );
}

function DayCard({
  day,
  label,
  testId,
  refreshing = false,
}: {
  day: DayPlan;
  label: string;
  testId: string;
  refreshing?: boolean;
}) {
  return (
    <article
      className="relative flex flex-col gap-2 rounded-lg border bg-card p-4"
      data-testid={testId}
      aria-busy={refreshing || undefined}
    >
      <div
        className={
          refreshing ? "flex flex-col gap-2 opacity-40" : "flex flex-col gap-2"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">
            {label} · {formatPlanDate(day.date)}
          </h3>
          <span className="flex items-center gap-2">
            {(day.status === "completed" || day.status === "partial") && (
              <StatusBadge status={day.status} />
            )}
            <span className="rounded border bg-muted px-2 py-0.5 text-xs capitalize">
              {day.type === "rest"
                ? "Rest day"
                : `${day.durationMinutes} min · ${day.intensity}`}
            </span>
          </span>
        </div>
        <p className="text-base font-medium">{day.title}</p>
        {day.type === "workout" &&
          (day.weather != null || day.forecasts != null) && (
            <WeatherSummary weather={day.weather} forecasts={day.forecasts} />
          )}
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {day.description}
        </p>
        {day.alternatives.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">Alternatives</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {day.alternatives.map((alternative) => (
                <li key={alternative}>{alternative}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm">
          <span className="font-medium">Coach's rationale: </span>
          <span className="text-muted-foreground">{day.rationale}</span>
        </p>
        {day.type === "workout" && day.optionalRationale && (
          <div
            className="rounded border bg-muted p-3 text-sm"
            data-testid={`${testId}-optionality`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="font-medium">Why this session matters</p>
              <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                {day.optional ? "Optional session" : "Do not skip this session"}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {day.optionalRationale}
            </p>
          </div>
        )}
      </div>
      {refreshing && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-card/60"
          data-testid={`${testId}-refreshing`}
        >
          <span
            className="inline-flex size-6 animate-spin rounded-full border-2 border-current border-t-transparent text-primary"
            role="status"
            aria-label={`Updating ${label.toLowerCase()}'s plan`}
          />
          <span className="text-sm text-muted-foreground">
            Updating {label.toLowerCase()}&apos;s plan…
          </span>
        </div>
      )}
    </article>
  );
}

function WeekSection({
  week,
  label,
  testId,
}: {
  week: WeekPlan;
  label: string;
  testId?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4" data-testid={testId}>
      <h3 className="text-lg font-semibold">
        {label} · {week.focus}
      </h3>
      <p className="text-sm text-muted-foreground">
        Week starting {formatPlanDate(week.startDate)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{week.rationale}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {week.sessions.map((session) => (
          <li
            key={session.date}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-b-0 last:pb-0"
          >
            <span className="font-medium">{formatPlanDate(session.date)}</span>
            <span>{session.title}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <StatusBadge status={session.status} />
              {session.type === "rest"
                ? "Rest"
                : session.status === "completed" &&
                    session.durationMinutes === 0
                  ? "Logged manually"
                  : `${session.durationMinutes} min · ${session.intensity}`}
            </span>
            {session.type === "workout" &&
              (session.weather != null || session.forecasts != null) && (
                <div className="w-full" data-testid="week-weather">
                  <WeatherSummary
                    weather={session.weather}
                    forecasts={session.forecasts}
                  />
                </div>
              )}
            {(session.status === "completed" ||
              session.status === "partial" ||
              session.status === "missed") && (
              <p className="w-full text-xs text-muted-foreground">
                {session.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({ status }: { status: WeekSessionStatus }) {
  return (
    <span className="rounded border bg-muted px-2 py-0.5 text-xs capitalize">
      {status}
    </span>
  );
}

function BlockSection({
  block,
  label,
  testId,
}: {
  block: BlockPlan;
  label: string;
  testId?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4" data-testid={testId}>
      <h3 className="text-lg font-semibold">
        {label} · {block.name}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">{block.focus}</p>
      <p className="text-sm text-muted-foreground">
        {formatPlanDate(block.startDate)} → {formatPlanDate(block.endDate)}
      </p>
      <p className="mt-2 text-sm">
        <span className="font-medium">Coach's rationale: </span>
        <span className="text-muted-foreground">{block.rationale}</span>
      </p>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {block.weeks.map((week) => (
          <li key={`${week.number}-${week.startDate}`}>
            <span className="font-medium">Week {week.number}</span> ·{" "}
            {week.focus} · {week.targetLoad}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeasonSection({ season }: { season: SeasonPlan }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="text-lg font-semibold">Season · {season.goal}</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {formatPlanDate(season.startDate)} → {formatPlanDate(season.endDate)}
      </p>
      <p className="mt-2 text-sm">
        <span className="font-medium">Coach's rationale: </span>
        <span className="text-muted-foreground">{season.rationale}</span>
      </p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {season.blocks.map((block, index) => (
          <li key={`${block.name}-${block.startDate}`}>
            <span className="font-medium">
              {index + 1}. {block.name}
            </span>{" "}
            · {formatPlanDate(block.startDate)} →{" "}
            {formatPlanDate(block.endDate)} · {block.weekCount}{" "}
            {block.weekCount === 1 ? "week" : "weeks"}
            <p className="text-muted-foreground">{block.focus}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function formatPlanDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
