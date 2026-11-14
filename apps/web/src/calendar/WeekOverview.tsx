import {
  EMPTY_WEEK_STATS,
  type CalendarDay,
  type CalendarWeek,
  type WeekSession,
} from "@killingit/shared";
import { formatPlanDate } from "../plan/formatPlanDate";

/**
 * The box to the left of each Monday row: the week's block, number, focus,
 * target load and workout count, plus its completed and planned time and TSS.
 * A future week with nothing planned yet hides its statistics.
 */
export function WeekOverview({
  weekStart,
  week,
  days,
  today,
}: {
  weekStart: string;
  week: CalendarWeek | undefined;
  days: Array<CalendarDay | undefined>;
  today: string;
}) {
  const sessions = days
    .map((day) => day?.session)
    .filter(
      (session): session is WeekSession =>
        session !== undefined && session !== null && session.type === "workout",
    );
  const stats = week?.stats ?? EMPTY_WEEK_STATS;
  const hasPlan =
    sessions.length > 0 ||
    (week !== undefined &&
      (week.blockName !== null ||
        week.focus !== null ||
        week.weekNumber !== null ||
        stats.plannedMinutes > 0));
  const hasStats =
    stats.plannedMinutes > 0 ||
    stats.completedMinutes > 0 ||
    stats.plannedTss > 0 ||
    stats.completedTss > 0;
  // A future week with nothing planned yet has no statistics to report. Past and
  // current weeks keep their record even when the numbers are zero.
  const showStats = hasStats || weekStart <= today;

  return (
    <div
      className="flex flex-col gap-1 rounded border bg-muted/30 p-1.5 text-sm"
      data-testid="calendar-week-overview"
      data-week-start={weekStart}
      aria-label={`Plan for the week of ${formatPlanDate(weekStart)}`}
    >
      {week !== undefined && week.blockName !== null && (
        <span className="font-medium" data-testid="calendar-week-block">
          {week.blockName}
        </span>
      )}
      {week !== undefined && week.focus !== null && (
        <span
          className="line-clamp-3 text-muted-foreground"
          data-testid="calendar-week-focus"
        >
          {week.focus}
        </span>
      )}
      {week !== undefined &&
        week.focus === null &&
        week.weekNumber !== null && (
          <span
            className="text-muted-foreground"
            data-testid="calendar-week-number"
          >
            Week {week.weekNumber}
          </span>
        )}
      {week !== undefined && week.targetLoad !== null && (
        <span className="text-xs text-muted-foreground">
          Target load: {week.targetLoad}
        </span>
      )}
      {sessions.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {sessions.length} workout{sessions.length === 1 ? "" : "s"}
        </span>
      )}
      {showStats && (
        <div
          className="flex flex-col gap-0.5 text-xs text-muted-foreground"
          data-testid="calendar-week-stats"
        >
          <span data-testid="calendar-week-time">
            Time:{" "}
            <span className="font-medium text-foreground">
              {formatWeekDuration(stats.completedMinutes)}
            </span>{" "}
            done · {formatWeekDuration(stats.plannedMinutes)} planned
          </span>
          <span data-testid="calendar-week-tss">
            TSS:{" "}
            <span className="font-medium text-foreground">
              {Math.round(stats.completedTss)}
            </span>{" "}
            done · {Math.round(stats.plannedTss)} planned
          </span>
        </div>
      )}
      {!hasPlan && !hasStats && (
        <span className="text-muted-foreground">No plan yet</span>
      )}
    </div>
  );
}

function formatWeekDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) {
    return `${remainder} min`;
  }
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}
