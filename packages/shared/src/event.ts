import { z } from "zod";
import { planDateSchema } from "./date.js";
import { coachResponseNotesSchema } from "./llm.js";
import { athleteMetricStatementSchema } from "./metrics.js";

/**
 * What a dated athlete statement is. A race is a competition with a start and a
 * finish; an event is another dated commitment such as a group ride, a sportive
 * or an appointment; a trip is travel that changes when the athlete can train;
 * a goal is a dated target that is not a competition, such as covering 100 km by
 * a given day.
 */
export const ATHLETE_EVENT_KINDS = ["race", "event", "trip", "goal"] as const;

export const athleteEventKindSchema = z.enum(ATHLETE_EVENT_KINDS);

export type AthleteEventKind = z.infer<typeof athleteEventKindSchema>;

/** The label shown beside an event's title in the app. */
export const ATHLETE_EVENT_KIND_LABELS: Record<AthleteEventKind, string> = {
  race: "Race",
  event: "Event",
  trip: "Trip",
  goal: "Goal",
};

/**
 * One dated goal or event the athlete stated in their own words. `endDate` is
 * null for a one-day event; when it is set, the event covers both days.
 */
export const athleteEventSchema = z.object({
  startDate: planDateSchema,
  endDate: planDateSchema.nullable().default(null),
  /** A short name the athlete would recognise, not a sentence. */
  title: z.string().trim().min(1).max(80),
  kind: athleteEventKindSchema,
});

export type AthleteEvent = z.infer<typeof athleteEventSchema>;

/** The coach's reading of every dated goal or event the athlete states. */
export const athleteEventsResultSchema = z
  .object({
    events: z.array(athleteEventSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type AthleteEventsResult = z.infer<typeof athleteEventsResultSchema>;

/**
 * One reading of the athlete's own words: the measurements and the dated goals
 * or events they state, returned together so the text is sent only once.
 */
export const athleteReadingResultSchema = z
  .object({
    statements: z.array(athleteMetricStatementSchema).default([]),
    events: z.array(athleteEventSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type AthleteReadingResult = z.infer<typeof athleteReadingResultSchema>;

/** The last day an event covers, which is its start day when it has no end. */
export function eventEndDate(
  event: Pick<AthleteEvent, "startDate" | "endDate">,
): string {
  return event.endDate ?? event.startDate;
}

/** True when `date` falls inside the event's dates. */
export function eventCoversDate(
  event: Pick<AthleteEvent, "startDate" | "endDate">,
  date: string,
): boolean {
  return date >= event.startDate && date <= eventEndDate(event);
}

/** True when the event's dates overlap the inclusive range. */
export function eventOverlapsRange(
  event: Pick<AthleteEvent, "startDate" | "endDate">,
  startDate: string,
  endDate: string,
): boolean {
  return event.startDate <= endDate && eventEndDate(event) >= startDate;
}

/**
 * A human-readable date or date range for an event, such as `14 Mar 2027` or
 * `14–16 Mar 2027`. Kept short so it fits beside an event's title.
 */
export function formatEventDates(
  event: Pick<AthleteEvent, "startDate" | "endDate">,
): string {
  const start = formatShortDate(event.startDate);
  const end = event.endDate;
  if (end === null || end === event.startDate) {
    return start;
  }
  // A range inside one month drops the repeated month, so 14–16 Mar 2027 stays
  // compact; a range across months keeps both full dates.
  if (end.slice(0, 7) === event.startDate.slice(0, 7)) {
    return `${Number(event.startDate.slice(8, 10))}–${formatShortDate(end)}`;
  }
  return `${start} – ${formatShortDate(end)}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `YYYY-MM-DD` as `14 Mar 2027`. */
function formatShortDate(date: string): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
  return `${Number(date.slice(8, 10))} ${month} ${date.slice(0, 4)}`;
}
