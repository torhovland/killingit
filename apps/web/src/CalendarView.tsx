import { useState } from "react";
import {
  ATHLETE_EVENT_KIND_LABELS,
  EMPTY_WEEK_STATS,
  activityAverageSpeed,
  formatActivityPaceOrSpeed,
  formatActivityType,
  formatDuration,
  formatEventDates,
  type CalendarActivity,
  type CalendarDay,
  type CalendarResponse,
  type CalendarWeek,
  type WeekSession,
} from "@killingit/shared";
import { ActivityMap } from "./ActivityMap";
import { Bullet, Bullets } from "./Bullet";
import {
  buildMonthGrid,
  clampMonth,
  dayNumber,
  formatMonth,
  monthOf,
  shiftMonth,
} from "./calendarDates";
import { formatPlanDate } from "./CoachPlanView";
import { FormattedText } from "./FormattedText";
import { SessionSetting } from "./SessionSetting";
import { TrainingLoadLine } from "./TrainingLoadLine";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";
import { WeatherSummary } from "./WeatherSummary";
import { Button } from "./components/Button";
import { Input } from "./components/Input";
import { Modal } from "./components/Modal";
import { StatusBadge } from "./components/StatusBadge";

export type CalendarSelection =
  | { kind: "activity"; activity: CalendarActivity }
  | { kind: "session"; session: WeekSession };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The calendar page content: one month of recorded activities, planned
 * workouts and rest days, block starts, and the season end. Presentational so
 * it can be rendered without auth or network.
 */
export function CalendarView({
  data,
  month,
  onMonthChange,
  today,
  loading = false,
  error = null,
}: {
  /** Null while the first load is in flight. */
  data: CalendarResponse | null;
  /** The visible month in `YYYY-MM` form. */
  month: string;
  onMonthChange: (month: string) => void;
  today: string;
  loading?: boolean;
  error?: string | null;
}) {
  const [selection, setSelection] = useState<CalendarSelection | null>(null);

  if (data === null) {
    return (
      <section className="flex w-full flex-col gap-4 text-left">
        <CalendarHeading />
        {error ? (
          <p className="text-destructive">Error: {error}</p>
        ) : (
          <p className="text-base text-muted-foreground">Loading…</p>
        )}
      </section>
    );
  }

  const minMonth = monthOf(data.earliestDate);
  const maxMonth = monthOf(data.latestDate);
  const shownMonth = clampMonth(month, minMonth, maxMonth);
  const daysByDate = new Map(data.days.map((day) => [day.date, day]));
  const cells = buildMonthGrid(shownMonth);
  const weeksByStart = new Map(
    data.weeks.map((week) => [week.startDate, week]),
  );
  const rows = Array.from({ length: 6 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );

  function moveMonth(delta: number): void {
    onMonthChange(
      clampMonth(shiftMonth(shownMonth, delta), minMonth, maxMonth),
    );
  }

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      <CalendarHeading goal={data.season?.goal ?? null} />

      {error && <p className="text-destructive">Error: {error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="disabled:opacity-40"
            onClick={() => moveMonth(-1)}
            disabled={shownMonth <= minMonth}
            aria-label="Previous month"
          >
            <MonthArrow direction="previous" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="disabled:opacity-40"
            onClick={() => moveMonth(1)}
            disabled={shownMonth >= maxMonth}
            aria-label="Next month"
          >
            <MonthArrow direction="next" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="inline-flex h-9 items-center justify-center py-0 leading-none"
            onClick={() =>
              onMonthChange(clampMonth(monthOf(today), minMonth, maxMonth))
            }
          >
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span
              className="text-base text-muted-foreground"
              aria-live="polite"
            >
              Updating…
            </span>
          )}
          <label className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">Month</span>
            <Input
              type="month"
              size="sm"
              value={shownMonth}
              min={minMonth}
              max={maxMonth}
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d{4}-\d{2}$/.test(value)) {
                  onMonthChange(clampMonth(value, minMonth, maxMonth));
                }
              }}
              aria-label="Choose a month"
            />
          </label>
        </div>
      </div>

      <h3 className="text-xl font-semibold" data-testid="calendar-month">
        {formatMonth(shownMonth)}
      </h3>

      <div className="overflow-x-auto">
        {/* The today ring is painted outside its cell, so the grid keeps
            padding; the scroll container would otherwise clip it, hiding the
            ring's right side on Sunday. */}
        <div className="min-w-[66rem] p-1" data-testid="calendar-grid">
          <div className="grid grid-cols-[minmax(14rem,18rem)_repeat(7,minmax(0,1fr))] gap-1 pb-1 text-center text-sm font-medium text-muted-foreground">
            <span />
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(14rem,18rem)_repeat(7,minmax(0,1fr))] gap-1">
            {rows.map((row) => {
              const weekStart = row[0]?.date ?? "";
              const weekDays = row.map((cell) => daysByDate.get(cell.date));
              return (
                <div key={weekStart} className="contents">
                  <WeekOverview
                    weekStart={weekStart}
                    week={weeksByStart.get(weekStart)}
                    days={weekDays}
                    today={today}
                  />
                  {row.map((cell, index) => (
                    <CalendarCell
                      key={cell.date}
                      date={cell.date}
                      inMonth={cell.inMonth}
                      isToday={cell.date === today}
                      today={today}
                      day={weekDays[index]}
                      onSelect={setSelection}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Showing {formatPlanDate(data.earliestDate)} –{" "}
        {formatPlanDate(data.latestDate)}. Future workouts appear as the coach
        plans each week.
      </p>

      <CalendarEntryDialog
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </section>
  );
}

function CalendarHeading({ goal }: { goal?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-semibold">Calendar</h2>
      {goal && (
        <p className="text-base" data-testid="calendar-season">
          <span className="font-medium">Goal: </span>
          <span className="text-muted-foreground">{goal}</span>
        </p>
      )}
    </div>
  );
}

/** A crisp chevron for the month navigation, centred in its button. */
function MonthArrow({ direction }: { direction: "previous" | "next" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={direction === "previous" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"}
      />
    </svg>
  );
}

function WeekOverview({
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

function CalendarCell({
  date,
  inMonth,
  isToday,
  today,
  day,
  onSelect,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  today: string;
  day: CalendarDay | undefined;
  onSelect: (selection: CalendarSelection) => void;
}) {
  const session = day?.session ?? null;
  // Past days show what was recorded, not what was planned. Today only keeps
  // its planned session when nothing has been recorded yet.
  const showSession =
    session !== null &&
    (date > today || (date === today && (day?.activities.length ?? 0) === 0));

  return (
    <div
      className={`flex min-h-28 flex-col gap-1 rounded border p-1.5 text-sm ${
        inMonth ? "bg-card" : "bg-muted/40 text-muted-foreground"
      } ${isToday ? "ring-2 ring-ring" : ""}`}
      data-testid={inMonth ? "calendar-day" : undefined}
      data-date={date}
    >
      <span
        className={`self-start rounded px-1 text-sm ${
          isToday ? "bg-primary font-semibold text-primary-foreground" : ""
        }`}
      >
        {dayNumber(date)}
      </span>

      {day?.blockStart && (
        <span
          className="rounded bg-accent px-1 py-0.5 font-medium text-accent-foreground"
          data-testid="calendar-block-start"
        >
          Block starts:
          <br />
          {day.blockStart.name}
        </span>
      )}

      {day?.seasonEnd && (
        <span
          className="rounded bg-accent px-1 py-0.5 font-medium text-accent-foreground"
          data-testid="calendar-season-end"
        >
          Season ends
        </span>
      )}

      {day?.events.map((event, index) => (
        <span
          key={`${event.startDate}-${event.title}-${index}`}
          className="rounded bg-accent px-1 py-0.5 font-medium text-accent-foreground"
          data-testid="calendar-event"
          title={formatEventDates(event)}
        >
          {ATHLETE_EVENT_KIND_LABELS[event.kind]}: {event.title}
        </span>
      ))}

      {showSession && session !== null && (
        <SessionChip
          session={session}
          onSelect={() => onSelect({ kind: "session", session })}
        />
      )}

      {day?.activities.map((activity, index) => (
        <ActivityChip
          key={`${activity.source}-${activity.id}-${index}`}
          activity={activity}
          onSelect={() => onSelect({ kind: "activity", activity })}
        />
      ))}
    </div>
  );
}

function SessionChip({
  session,
  onSelect,
}: {
  session: WeekSession;
  onSelect: () => void;
}) {
  if (session.type === "rest") {
    return (
      <span
        className="rounded bg-muted px-1 py-0.5 text-muted-foreground"
        data-testid="calendar-rest"
      >
        Rest
      </span>
    );
  }

  return (
    <button
      type="button"
      className="flex flex-col rounded bg-primary/15 px-1 py-0.5 text-left enabled:hover:bg-primary/25"
      onClick={onSelect}
      data-testid="calendar-session"
    >
      <span className="line-clamp-2 font-medium">{session.title}</span>
      <span className="text-xs text-muted-foreground">
        {session.durationMinutes} min
      </span>
    </button>
  );
}

function ActivityChip({
  activity,
  onSelect,
}: {
  activity: CalendarActivity;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex flex-col rounded bg-success/15 px-1 py-0.5 text-left enabled:hover:bg-success/25"
      onClick={onSelect}
      data-testid="calendar-activity"
    >
      <span className="line-clamp-2 font-medium">{activity.name}</span>
      <span className="text-xs text-muted-foreground">
        <Bullets parts={activityStat(activity)} />
      </span>
    </button>
  );
}

function activityStat(activity: CalendarActivity): string[] {
  if (activity.source === "manual") {
    return activity.estimatedTss != null
      ? ["Manual", `TSS ${Math.round(activity.estimatedTss)}`]
      : ["Manual"];
  }
  const parts: string[] = [];
  if (activity.distance > 0) {
    parts.push(`${(activity.distance / 1000).toFixed(1)} km`);
  }
  parts.push(formatDuration(activity.elapsedTime));
  return parts;
}

export function CalendarEntryDialog({
  selection,
  onClose,
}: {
  selection: CalendarSelection | null;
  onClose: () => void;
}) {
  if (selection === null) {
    return null;
  }

  return (
    <Modal
      labelledBy="calendar-entry-title"
      onClose={onClose}
      className="max-h-full max-w-2xl overflow-y-auto"
      testId="calendar-entry-dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="calendar-entry-title" className="text-xl font-semibold">
          {selection.kind === "activity" ? (
            selection.activity.name
          ) : (
            <>
              {formatPlanDate(selection.session.date)}
              <Bullet />
              {selection.session.title}
            </>
          )}
        </h3>
        <Button type="button" variant="secondary" size="xs" onClick={onClose}>
          Close
        </Button>
      </div>

      {selection.kind === "activity" ? (
        <ActivityDetails activity={selection.activity} />
      ) : (
        <SessionDetails session={selection.session} />
      )}
    </Modal>
  );
}

function ActivityDetails({ activity }: { activity: CalendarActivity }) {
  const timeZone = useTimeZone();

  if (activity.source === "manual") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-base text-muted-foreground">
          Manual activity
          <Bullet />
          {formatPlanDate(activity.startDate)}
        </p>
        <p className="whitespace-pre-line">{activity.details}</p>
        {activity.estimatedTss != null && (
          <p className="text-base">
            <span className="font-medium">Estimated TSS: </span>
            {Math.round(activity.estimatedTss)}
          </p>
        )}
        {activity.trainingLoad != null && (
          <TrainingLoadLine
            load={activity.trainingLoad}
            testId="calendar-dialog-load"
          />
        )}
        {activity.coachReply && (
          <div
            className="flex flex-col gap-1 text-base"
            data-testid="calendar-dialog-coach-reply"
          >
            <span className="font-medium">Coach:</span>
            <FormattedText text={activity.coachReply.text} />
          </div>
        )}
      </div>
    );
  }

  const route = activity.route ?? [];
  const hasMap = route.length >= 2;
  const metadata = [
    formatDateTime(activity.startDate, timeZone),
    formatActivityType(activity.type),
  ];
  if (activity.distance > 0) {
    metadata.push(`${(activity.distance / 1000).toFixed(2)} km`);
  }
  const averageSpeed = activityAverageSpeed(activity);
  if (averageSpeed !== null) {
    const paceOrSpeed = formatActivityPaceOrSpeed(activity.type, averageSpeed);
    if (paceOrSpeed !== null) {
      metadata.push(paceOrSpeed);
    }
  }
  metadata.push(formatDuration(activity.elapsedTime));
  if (activity.totalElevationGain > 0) {
    metadata.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }
  if (activity.averagePower != null && activity.averagePower > 0) {
    metadata.push(`${Math.round(activity.averagePower)} W average`);
  }
  if (activity.normalizedPower != null && activity.normalizedPower > 0) {
    metadata.push(`${Math.round(activity.normalizedPower)} W normalized`);
  }
  const summary =
    activity.analysis?.text.trim() ||
    activity.programAnalysis?.text.trim() ||
    "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted-foreground">
        <Bullets parts={metadata} />
      </p>

      {hasMap ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start">
          <div className="flex flex-col gap-2">
            <ActivitySummaryDetails activity={activity} summary={summary} />
          </div>
          <ActivityMap route={route} />
        </div>
      ) : (
        <ActivitySummaryDetails activity={activity} summary={summary} />
      )}

      {activity.comment && (
        <p className="text-base" data-testid="calendar-dialog-comment">
          <span className="font-medium">You:</span> {activity.comment}
        </p>
      )}
      {activity.coachReply && (
        <div
          className="flex flex-col gap-1 text-base"
          data-testid="calendar-dialog-coach-reply"
        >
          <span className="font-medium">Coach:</span>
          <FormattedText text={activity.coachReply.text} />
        </div>
      )}
    </div>
  );
}

function ActivitySummaryDetails({
  activity,
  summary,
}: {
  activity: Extract<CalendarActivity, { source: "garmin" }>;
  summary: string;
}) {
  return (
    <>
      {activity.trainingLoad != null && (
        <TrainingLoadLine
          load={activity.trainingLoad}
          tss={activity.activityTss ?? undefined}
          testId="calendar-dialog-load"
        />
      )}
      {summary ? (
        <FormattedText text={summary} />
      ) : (
        <p className="rounded bg-accent/15 p-2 text-base">
          {activity.analysisError
            ? `Coach analysis unavailable: ${activity.analysisError}`
            : "No coach analysis available yet."}
        </p>
      )}
    </>
  );
}

function SessionDetails({ session }: { session: WeekSession }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-base text-muted-foreground">
        <span>{formatPlanDate(session.date)}</span>
        <StatusBadge status={session.status} />
        <span>
          {session.type === "rest" ? (
            "Rest day"
          ) : (
            <>
              {session.durationMinutes} min
              <Bullet />
              {session.intensity}
              <SessionSetting outdoor={session.outdoor} />
            </>
          )}
        </span>
      </p>
      {session.trainingLoad != null && (
        <TrainingLoadLine
          load={session.trainingLoad}
          testId="calendar-dialog-load"
        />
      )}
      {session.type === "workout" &&
        session.canBeOutdoor !== false &&
        (session.weather != null || session.forecasts != null) && (
          <WeatherSummary
            weather={session.weather}
            forecasts={session.forecasts}
          />
        )}
      <FormattedText
        text={session.description}
        className="text-base text-muted-foreground"
      />
      {session.type === "workout" &&
        session.trainingLoad == null &&
        session.estimatedTss != null && (
          <p className="text-base">
            <span className="font-medium">Estimated TSS: </span>
            {Math.round(session.estimatedTss)}
          </p>
        )}
    </div>
  );
}
