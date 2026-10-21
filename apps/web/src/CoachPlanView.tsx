import type {
  BlockPlan,
  CoachPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
  WeekSessionStatus,
} from "@killingit/shared";

/**
 * Presentational four-level plan. Kept separate from the fetching/progress
 * container so it can be rendered and tested without auth or network access.
 */
export function CoachPlanView({
  plan,
  showTomorrow = false,
}: {
  plan: CoachPlan;
  showTomorrow?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="coach-plan-view">
      <DayCard day={plan.today} label="Today" testId="plan-today" />
      {showTomorrow && plan.tomorrow && (
        <DayCard day={plan.tomorrow} label="Tomorrow" testId="plan-tomorrow" />
      )}
      <WeekSection week={plan.week} />
      <BlockSection block={plan.block} />
      <SeasonSection season={plan.season} />
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
    </article>
  );
}

function WeekSection({ week }: { week: WeekPlan }) {
  return (
    <details open className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer text-lg font-semibold">
        This week · {week.focus}
      </summary>
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
    </details>
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
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer text-lg font-semibold">
        Block · {block.name}
      </summary>
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
    </details>
  );
}

function SeasonSection({ season }: { season: SeasonPlan }) {
  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer text-lg font-semibold">
        Season · {season.goal}
      </summary>
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
    </details>
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
