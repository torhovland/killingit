import { useState } from "react";
import type {
  BlockPlan,
  CoachPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
  WeekSessionStatus,
} from "@killingit/shared";

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
}: {
  plan: CoachPlan;
  showTomorrow?: boolean;
  defaultTab?: PlanTab;
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
            <DayCard day={plan.today} label="Today" testId="plan-today" />
            {showTomorrow && plan.tomorrow && (
              <DayCard
                day={plan.tomorrow}
                label="Tomorrow"
                testId="plan-tomorrow"
              />
            )}
          </div>
        )}
        {tab === "week" && <WeekSection week={plan.week} />}
        {tab === "block" && <BlockSection block={plan.block} />}
        {tab === "season" && <SeasonSection season={plan.season} />}
      </div>
    </div>
  );
}

function DayCard({
  day,
  label,
  testId,
}: {
  day: DayPlan;
  label: string;
  testId: string;
}) {
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border bg-card p-4"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {label} · {formatPlanDate(day.date)}
        </h3>
        <span className="rounded border bg-muted px-2 py-0.5 text-xs capitalize">
          {day.type === "rest"
            ? "Rest day"
            : `${day.durationMinutes} min · ${day.intensity}`}
        </span>
      </div>
      <p className="text-base font-medium">{day.title}</p>
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
      {day.optionalRationale && (
        <div
          className="rounded border bg-muted p-3 text-sm"
          data-testid={`${testId}-optionality`}
        >
          <p className="font-medium">
            {day.optional ? "Optional session" : "Do not skip this session"}
          </p>
          <p className="text-muted-foreground">{day.optionalRationale}</p>
        </div>
      )}
    </article>
  );
}

function WeekSection({ week }: { week: WeekPlan }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="text-lg font-semibold">This week · {week.focus}</h3>
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
            {(session.status === "completed" ||
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

function BlockSection({ block }: { block: BlockPlan }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="text-lg font-semibold">Block · {block.name}</h3>
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
