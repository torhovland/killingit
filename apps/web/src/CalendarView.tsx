import { useEffect, useState } from "react";
import {
  formatActivityType,
  type CalendarActivity,
  type CalendarDay,
  type CalendarResponse,
  type WeekSession,
  type WeekSessionStatus,
} from "@killingit/shared";
import { ActivityMap } from "./ActivityMap";
import {
  buildMonthGrid,
  clampMonth,
  dayNumber,
  formatMonth,
  monthOf,
  shiftMonth,
} from "./calendarDates";
import { formatPlanDate } from "./CoachPlanView";
import { formatDuration } from "./formatDuration";
import { TrainingLoadLine } from "./TrainingLoadLine";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";
import { WeatherSummary } from "./WeatherSummary";

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
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </section>
    );
  }

  const minMonth = monthOf(data.earliestDate);
  const maxMonth = monthOf(data.latestDate);
  const shownMonth = clampMonth(month, minMonth, maxMonth);
  const daysByDate = new Map(data.days.map((day) => [day.date, day]));
  const cells = buildMonthGrid(shownMonth);

  function moveMonth(delta: number): void {
    onMonthChange(
      clampMonth(shiftMonth(shownMonth, delta), minMonth, maxMonth),
    );
  }

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      <CalendarHeading
        season={
          data.season === null
            ? null
            : { goal: data.season.goal, endDate: data.season.endDate }
        }
      />

      {error && <p className="text-destructive">Error: {error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted disabled:opacity-40"
            onClick={() => moveMonth(-1)}
            disabled={shownMonth <= minMonth}
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted disabled:opacity-40"
            onClick={() => moveMonth(1)}
            disabled={shownMonth >= maxMonth}
            aria-label="Next month"
          >
            →
          </button>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted"
            onClick={() =>
              onMonthChange(clampMonth(monthOf(today), minMonth, maxMonth))
            }
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              Updating…
            </span>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Month</span>
            <input
              type="month"
              className="rounded border bg-card px-2 py-1 text-sm"
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

      <h3 className="text-lg font-semibold" data-testid="calendar-month">
        {formatMonth(shownMonth)}
      </h3>

      <div className="overflow-x-auto">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => (
              <CalendarCell
                key={cell.date}
                date={cell.date}
                inMonth={cell.inMonth}
                isToday={cell.date === today}
                day={daysByDate.get(cell.date)}
                onSelect={setSelection}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
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

function CalendarHeading({
  season,
}: {
  season?: { goal: string; endDate: string } | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold">Calendar</h2>
      <p className="text-sm text-muted-foreground">
        Your recorded activities, planned workouts and rest days in one month.
      </p>
      {season && (
        <p className="text-sm" data-testid="calendar-season">
          <span className="font-medium">
            Season ends {formatPlanDate(season.endDate)}
          </span>
          <span className="text-muted-foreground"> · {season.goal}</span>
        </p>
      )}
    </div>
  );
}

function CalendarCell({
  date,
  inMonth,
  isToday,
  day,
  onSelect,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  day: CalendarDay | undefined;
  onSelect: (selection: CalendarSelection) => void;
}) {
  return (
    <div
      className={`flex min-h-28 flex-col gap-1 rounded border p-1.5 text-xs ${
        inMonth ? "bg-card" : "bg-muted/40 text-muted-foreground"
      } ${isToday ? "ring-2 ring-ring" : ""}`}
      data-testid={inMonth ? "calendar-day" : undefined}
      data-date={date}
    >
      <span
        className={`self-start rounded px-1 text-xs ${
          isToday ? "bg-primary font-semibold text-primary-foreground" : ""
        }`}
      >
        {dayNumber(date)}
      </span>

      {day?.blockStart && (
        <span
          className="rounded bg-accent/20 px-1 py-0.5 font-medium text-accent-foreground"
          data-testid="calendar-block-start"
        >
          Block starts · {day.blockStart.name}
        </span>
      )}

      {day?.seasonEnd && (
        <span
          className="rounded bg-accent/20 px-1 py-0.5 font-medium text-accent-foreground"
          data-testid="calendar-season-end"
        >
          Season ends
        </span>
      )}

      {day?.session && (
        <SessionChip
          session={day.session}
          onSelect={() =>
            onSelect({ kind: "session", session: day.session as WeekSession })
          }
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
      <span className="text-[10px] text-muted-foreground">
        {sessionStatusPrefix(session.status)}
        {session.durationMinutes} min · {session.intensity}
        {session.trainingLoad != null &&
          ` · TSS ${Math.round(session.trainingLoad.tss)}`}
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
      <span className="text-[10px] text-muted-foreground">
        {activityStat(activity)}
      </span>
    </button>
  );
}

function activityStat(activity: CalendarActivity): string {
  if (activity.source === "manual") {
    return activity.estimatedTss != null
      ? `Manual · TSS ${Math.round(activity.estimatedTss)}`
      : "Manual";
  }
  const parts: string[] = [];
  if (activity.distance > 0) {
    parts.push(`${(activity.distance / 1000).toFixed(1)} km`);
  }
  parts.push(formatDuration(activity.elapsedTime));
  return parts.join(" · ");
}

export function CalendarEntryDialog({
  selection,
  onClose,
}: {
  selection: CalendarSelection | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (selection === null) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selection, onClose]);

  if (selection === null) {
    return null;
  }

  const title =
    selection.kind === "activity"
      ? selection.activity.name
      : selection.session.title;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-3"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        data-testid="calendar-entry-dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">
            {selection.kind === "activity"
              ? selection.activity.name
              : `${formatPlanDate(selection.session.date)} · ${selection.session.title}`}
          </h3>
          <button
            type="button"
            className="rounded border bg-card px-2 py-0.5 text-sm enabled:hover:bg-muted"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </div>

        {selection.kind === "activity" ? (
          <ActivityDetails activity={selection.activity} />
        ) : (
          <SessionDetails session={selection.session} />
        )}
      </div>
    </div>
  );
}

function ActivityDetails({ activity }: { activity: CalendarActivity }) {
  const timeZone = useTimeZone();

  if (activity.source === "manual") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Manual activity · {formatPlanDate(activity.startDate)}
        </p>
        <p className="whitespace-pre-line">{activity.details}</p>
        {activity.estimatedTss != null && (
          <p className="text-sm">
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
          <p className="text-sm" data-testid="calendar-dialog-coach-reply">
            <span className="font-medium">Coach:</span>{" "}
            {activity.coachReply.text}
          </p>
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
    activity.programAnalysis?.text.trim() ||
    activity.analysis?.text.trim() ||
    "";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{metadata.join(" · ")}</p>

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
        <p className="text-sm" data-testid="calendar-dialog-comment">
          <span className="font-medium">You:</span> {activity.comment}
        </p>
      )}
      {activity.coachReply && (
        <p className="text-sm" data-testid="calendar-dialog-coach-reply">
          <span className="font-medium">Coach:</span> {activity.coachReply.text}
        </p>
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
          testId="calendar-dialog-load"
        />
      )}
      {summary ? (
        <p className="whitespace-pre-line">{summary}</p>
      ) : (
        <p className="rounded bg-accent/15 p-2 text-sm">
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
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{formatPlanDate(session.date)}</span>
        <StatusBadge status={session.status} />
        <span>
          {session.type === "rest"
            ? "Rest day"
            : `${session.durationMinutes} min · ${session.intensity}${formatSessionSetting(session.outdoor)}`}
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
      <p className="whitespace-pre-line text-sm text-muted-foreground">
        {session.description}
      </p>
      {session.type === "workout" &&
        session.trainingLoad == null &&
        session.estimatedTss != null && (
          <p className="text-sm">
            <span className="font-medium">Estimated TSS: </span>
            {Math.round(session.estimatedTss)}
          </p>
        )}
    </div>
  );
}

function StatusBadge({ status }: { status: WeekSessionStatus }) {
  return (
    <span className="rounded border bg-muted px-2 py-0.5 text-xs capitalize">
      {status}
    </span>
  );
}

function formatSessionSetting(outdoor: boolean | undefined): string {
  return outdoor === false ? " · indoor" : outdoor === true ? " · outdoor" : "";
}

/** A short status prefix for a day whose session has already been resolved. */
function sessionStatusPrefix(status: WeekSessionStatus): string {
  if (status === "completed") {
    return "Completed · ";
  }
  if (status === "partial") {
    return "Partial · ";
  }
  return status === "missed" ? "Missed · " : "";
}
