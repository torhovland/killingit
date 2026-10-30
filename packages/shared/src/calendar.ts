import { z } from "zod";
import { analyzedActivitySchema, coachAnalysisSchema } from "./llm.js";
import {
  planDateSchema,
  seasonBlockSummarySchema,
  seasonPlanSchema,
  weekSessionSchema,
} from "./plan.js";
import { trainingLoadSchema } from "./trainingLoad.js";

/**
 * An imported activity shown on the calendar. It is the activity feed's shape,
 * so the detail dialog can show the same analysis, comments, and route as the
 * Activities page.
 */
export const calendarImportedActivitySchema = analyzedActivitySchema.extend({
  source: z.literal("garmin"),
});

export type CalendarImportedActivity = z.infer<
  typeof calendarImportedActivitySchema
>;

/**
 * A manually logged activity. It has no route or imported statistics, only the
 * athlete's description, the coach's reply, and any training-stress estimate.
 */
export const calendarManualActivitySchema = z.object({
  source: z.literal("manual"),
  id: z.number().int().positive(),
  /** The description, trimmed for use as the calendar title. */
  name: z.string().min(1),
  details: z.string().min(1),
  startDate: planDateSchema,
  coachReply: coachAnalysisSchema.nullable().default(null),
  /** The coach's TSS estimate for the entry, when one was stored. */
  estimatedTss: z.number().nonnegative().max(2000).nullable().optional(),
  trainingLoad: trainingLoadSchema.nullable().optional(),
});

export type CalendarManualActivity = z.infer<
  typeof calendarManualActivitySchema
>;

export const calendarActivitySchema = z.discriminatedUnion("source", [
  calendarImportedActivitySchema,
  calendarManualActivitySchema,
]);

export type CalendarActivity = z.infer<typeof calendarActivitySchema>;

/**
 * One calendar day with everything the page shows for it. Days without an
 * activity, a planned session, a block start, or the season end are omitted
 * from the response.
 */
export const calendarDaySchema = z.object({
  date: planDateSchema,
  /** Everything recorded on the day, imported activities first. */
  activities: z.array(calendarActivitySchema).default([]),
  /** The stored plan's workout or rest day, when the plan covers this date. */
  session: weekSessionSchema.nullable().default(null),
  /** The block that starts on this day, when one does. */
  blockStart: seasonBlockSummarySchema.nullable().default(null),
  /** Whether the season plan ends on this day. */
  seasonEnd: z.boolean().default(false),
});

export type CalendarDay = z.infer<typeof calendarDaySchema>;

/**
 * The coach's outline for one Monday-start week, shown beside the week's row.
 * Focus and target load come from the block plan when it describes the week;
 * otherwise the focus falls back to the block's own focus so later weeks of the
 * season still get a useful summary.
 */
export const calendarWeekSchema = z.object({
  startDate: planDateSchema,
  endDate: planDateSchema,
  /** The week's focus, or its block's focus when no week plan exists yet. */
  focus: z.string().nullable().default(null),
  /** The week's target load from the block plan, when it is known. */
  targetLoad: z.string().nullable().default(null),
  /** The season block that contains this week. */
  blockName: z.string().nullable().default(null),
});

export type CalendarWeek = z.infer<typeof calendarWeekSchema>;

/**
 * Response body of `GET /api/calendar`. `earliestDate` and `latestDate` bound
 * the months the page may show: the first data we have and the end of the
 * season (or today when no season exists).
 */
export const calendarResponseSchema = z.object({
  earliestDate: planDateSchema,
  latestDate: planDateSchema,
  /** The stored season plan, so the page can state its end date. */
  season: seasonPlanSchema.nullable().default(null),
  /** One outline per week that overlaps the available range. */
  weeks: z.array(calendarWeekSchema).default([]),
  days: z.array(calendarDaySchema).default([]),
});

export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
