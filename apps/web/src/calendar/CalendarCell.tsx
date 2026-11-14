import {
  ATHLETE_EVENT_KIND_LABELS,
  formatDuration,
  formatEventDates,
  type CalendarActivity,
  type CalendarDay,
  type WeekSession,
} from "@killingit/shared";
import { Bullets } from "../Bullet";
import { dayNumber } from "../calendarDates";
import { formatDistanceKm } from "../formatDistance";
import { Chip } from "../components/Chip";
import type { CalendarSelection } from "./selection";

/**
 * One day of the month grid: its number, a block or season marker, the
 * athlete's events, the planned session and every recorded activity.
 */
export function CalendarCell({
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
        <Chip data-testid="calendar-block-start">
          Block starts:
          <br />
          {day.blockStart.name}
        </Chip>
      )}

      {day?.seasonEnd && (
        <Chip data-testid="calendar-season-end">Season ends</Chip>
      )}

      {day?.events.map((event, index) => (
        <Chip
          key={`${event.startDate}-${event.title}-${index}`}
          data-testid="calendar-event"
          title={formatEventDates(event)}
        >
          {ATHLETE_EVENT_KIND_LABELS[event.kind]}: {event.title}
        </Chip>
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
    return <Chip variant="muted">Rest</Chip>;
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

/** A compact activity summary: source or distance, then the elapsed time. */
function activityStat(activity: CalendarActivity): string[] {
  if (activity.source === "manual") {
    return activity.estimatedTss != null
      ? ["Manual", `TSS ${Math.round(activity.estimatedTss)}`]
      : ["Manual"];
  }
  const parts: string[] = [];
  if (activity.distance > 0) {
    parts.push(formatDistanceKm(activity.distance, 1));
  }
  parts.push(formatDuration(activity.elapsedTime));
  return parts;
}
