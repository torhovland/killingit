import {
  ATHLETE_EVENT_KIND_LABELS,
  addDays,
  eventCoversDate,
  eventOverlapsRange,
  formatEventDates,
  type AthleteEvent,
} from "@killingit/shared";
import { Bullet } from "../Bullet";

/** Events that cover a single day. */
export function eventsOn(
  events: readonly AthleteEvent[],
  date: string,
): AthleteEvent[] {
  return events.filter((event) => eventCoversDate(event, date));
}

/** Events that overlap the seven days of a week. */
export function eventsInWeek(
  events: readonly AthleteEvent[],
  startDate: string,
): AthleteEvent[] {
  return events.filter((event) =>
    eventOverlapsRange(event, startDate, addDays(startDate, 6)),
  );
}

/**
 * The athlete's dated goals and events for the period a tab shows. A race or a
 * trip changes what the plan for that day or week should be, so the list sits
 * above the planned sessions instead of inside one of them.
 */
export function AthleteEventList({
  events,
  testId,
}: {
  events: readonly AthleteEvent[];
  testId: string;
}) {
  if (events.length === 0) {
    return null;
  }
  return (
    <section
      className="rounded-lg border bg-accent/15 p-3 text-base"
      data-testid={testId}
    >
      <p className="font-medium">Goals and events</p>
      <ul className="mt-1 flex flex-col gap-1">
        {events.map((event) => (
          <li key={`${event.startDate}-${event.title}`}>
            <span className="font-medium">{event.title}</span>
            <Bullet />
            {ATHLETE_EVENT_KIND_LABELS[event.kind]}
            <Bullet />
            {formatEventDates(event)}
          </li>
        ))}
      </ul>
    </section>
  );
}
