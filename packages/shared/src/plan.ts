import { z } from "zod";

/** A calendar date in `YYYY-MM-DD` form. */
export const planDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/**
 * One block in the season plan. `weekCount` is the planned length; the
 * detailed weeks live in the current block plan while that block is active.
 */
export const seasonBlockSummarySchema = z.object({
  name: z.string().min(1),
  focus: z.string().min(1),
  startDate: planDateSchema,
  endDate: planDateSchema,
  weekCount: z.number().int().positive(),
});

export type SeasonBlockSummary = z.infer<typeof seasonBlockSummarySchema>;

/** The high-level season: goal, dates, and the ordered blocks that build to it. */
export const seasonPlanSchema = z.object({
  goal: z.string().min(1),
  startDate: planDateSchema,
  endDate: planDateSchema,
  blocks: z.array(seasonBlockSummarySchema).min(1),
  /** The coach's explanation of the season's shape and training science. */
  rationale: z.string().min(1),
});

export type SeasonPlan = z.infer<typeof seasonPlanSchema>;

/** One week inside the active block plan. */
export const blockWeekSummarySchema = z.object({
  number: z.number().int().positive(),
  startDate: planDateSchema,
  focus: z.string().min(1),
  targetLoad: z.string().min(1),
});

export type BlockWeekSummary = z.infer<typeof blockWeekSummarySchema>;

/** The detailed plan for the block currently in progress. */
export const blockPlanSchema = z.object({
  name: z.string().min(1),
  focus: z.string().min(1),
  startDate: planDateSchema,
  endDate: planDateSchema,
  weeks: z.array(blockWeekSummarySchema).min(1),
  /** The coach's explanation of this block's purpose and progression. */
  rationale: z.string().min(1),
});

export type BlockPlan = z.infer<typeof blockPlanSchema>;

/** One day in the current week's plan. */
export const weekSessionStatusSchema = z.enum([
  "completed",
  "planned",
  "missed",
  "rest",
]);

export type WeekSessionStatus = z.infer<typeof weekSessionStatusSchema>;

export const weekSessionSchema = z.object({
  date: planDateSchema,
  day: z.string().min(1),
  type: z.enum(["workout", "rest"]),
  title: z.string().min(1),
  description: z.string().min(1),
  durationMinutes: z.number().int().nonnegative(),
  intensity: z.enum(["easy", "moderate", "hard", "rest"]),
  /**
   * Past days describe what actually happened (`completed`, `missed`, or
   * `rest`); today and future days are `planned` unless they are rest days.
   */
  status: weekSessionStatusSchema.default("planned"),
});

export type WeekSession = z.infer<typeof weekSessionSchema>;

/** The current week of the active block, with exactly seven sessions. */
export const weekPlanSchema = z.object({
  startDate: planDateSchema,
  focus: z.string().min(1),
  sessions: z.array(weekSessionSchema).length(7),
  /** The coach's explanation of this week's focus and load. */
  rationale: z.string().min(1),
});

export type WeekPlan = z.infer<typeof weekPlanSchema>;

/** The concrete workout or rest for a single day. */
export const dayPlanSchema = z.object({
  date: planDateSchema,
  type: z.enum(["workout", "rest"]),
  title: z.string().min(1),
  description: z.string().min(1),
  durationMinutes: z.number().int().nonnegative(),
  intensity: z.enum(["easy", "moderate", "hard", "rest"]),
  alternatives: z.array(z.string().min(1)).default([]),
  /** The coach's explanation of why this session suits today. */
  rationale: z.string().min(1),
  /** Whether the athlete can skip this session without derailing the plan. */
  optional: z.boolean().default(false),
  /** Why the athlete should not skip this session, or why it is optional. */
  optionalRationale: z.string().min(1).optional(),
});

export type DayPlan = z.infer<typeof dayPlanSchema>;

/** The complete four-level plan returned by an initial generation. */
export const coachPlanSchema = z.object({
  season: seasonPlanSchema,
  block: blockPlanSchema,
  week: weekPlanSchema,
  today: dayPlanSchema,
  /**
   * A suggested session for tomorrow. The coach fills this in so the UI can
   * show it after 18:00 without another generation.
   */
  tomorrow: dayPlanSchema.nullable().default(null),
});

export type CoachPlan = z.infer<typeof coachPlanSchema>;

/**
 * The first step of a full build: the season plan alone. Splitting the build
 * keeps each completion comfortably below the model's output budget.
 */
export const seasonPlanUpdateSchema = z.object({
  season: seasonPlanSchema,
});

export type SeasonPlanUpdate = z.infer<typeof seasonPlanUpdateSchema>;

/** The second step of a full build: the first block of the season. */
export const initialBlockUpdateSchema = z.object({
  block: blockPlanSchema,
});

export type InitialBlockUpdate = z.infer<typeof initialBlockUpdateSchema>;

/**
 * The daily cascade output: today's concrete session plus the remainder of the
 * week revised around it.
 */
export const dailyPlanUpdateSchema = z
  .object({
    today: dayPlanSchema,
    tomorrow: dayPlanSchema.nullable().default(null),
    week: weekPlanSchema,
  })
  .refine(
    (value) =>
      value.week.sessions.some((session) => session.date === value.today.date),
    {
      message: "Today's session must be one of the week's sessions",
      path: ["today", "date"],
    },
  );

export type DailyPlanUpdate = z.infer<typeof dailyPlanUpdateSchema>;

/** The weekly cascade output: the new week plus a revised block plan. */
export const weeklyPlanUpdateSchema = z.object({
  week: weekPlanSchema,
  block: blockPlanSchema,
});

export type WeeklyPlanUpdate = z.infer<typeof weeklyPlanUpdateSchema>;

/** The block cascade output: the next block plus a revised season plan. */
export const blockPlanUpdateSchema = z.object({
  block: blockPlanSchema,
  season: seasonPlanSchema,
});

export type BlockPlanUpdate = z.infer<typeof blockPlanUpdateSchema>;

/**
 * Progress reported while the coach is generating. `progress` is a percentage
 * (0–100) so the UI can render a determinate bar.
 */
export const planGenerationStatusSchema = z.object({
  status: z.enum(["idle", "running", "done", "error"]),
  step: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type PlanGenerationStatus = z.infer<typeof planGenerationStatusSchema>;

/** Which parts of the stored plan are missing for today's date. */
export const planPendingSchema = z.object({
  initial: z.boolean(),
  day: z.boolean(),
  week: z.boolean(),
  block: z.boolean(),
  /** After 18:00, tomorrow's session should also be present. */
  tomorrow: z.boolean(),
});

export type PlanPending = z.infer<typeof planPendingSchema>;

/** Response body of `GET /api/coaching/plan`. */
export const coachPlanResponseSchema = z.object({
  plan: coachPlanSchema.nullable(),
  generatedAt: z.string().datetime().nullable(),
  generation: planGenerationStatusSchema,
  stale: z.boolean(),
  pending: planPendingSchema,
});

export type CoachPlanResponse = z.infer<typeof coachPlanResponseSchema>;

/** Request body of `POST /api/coaching/plan/generate`. */
export const planGenerateInputSchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
  /** Rebuild the whole plan even when the stored levels are still current. */
  force: z.boolean().default(false),
  /** The client's local time is after 18:00, so tomorrow's session is wanted. */
  includeTomorrow: z.boolean().default(false),
});

export type PlanGenerateInput = z.infer<typeof planGenerateInputSchema>;

/** A manual activity the athlete recorded themselves. */
export const manualActivityInputSchema = z.object({
  startDate: planDateSchema,
  details: z.string().min(1).max(2000),
});

export type ManualActivityInput = z.infer<typeof manualActivityInputSchema>;

/** A comment the athlete added to an activity. */
export const activityCommentInputSchema = z.object({
  activityId: z.string().min(1),
  comment: z.string().min(1).max(2000),
});

export type ActivityCommentInput = z.infer<typeof activityCommentInputSchema>;

/** A general note the athlete added for the current week. */
export const weeklyNoteInputSchema = z.object({
  note: z.string().min(1).max(2000),
});

export type WeeklyNoteInput = z.infer<typeof weeklyNoteInputSchema>;

/** Request body of `POST /api/coaching/weekly/notes`. */
export const weeklyNoteRequestSchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
  note: z.string().min(1).max(2000),
});

export type WeeklyNoteRequest = z.infer<typeof weeklyNoteRequestSchema>;

/** Request body of `POST /api/coaching/activities/:activityId/comments`. */
export const activityCommentRequestSchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
  comment: z.string().min(1).max(2000),
});

export type ActivityCommentRequest = z.infer<
  typeof activityCommentRequestSchema
>;

/** Request body of `POST /api/coaching/activities/manual`. */
export const manualActivityRequestSchema = manualActivityInputSchema.extend({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
});

export type ManualActivityRequest = z.infer<typeof manualActivityRequestSchema>;
