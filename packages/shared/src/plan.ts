import { z } from "zod";
import { coachAnalysisSchema, coachResponseNotesSchema } from "./llm.js";
import { trainingLoadSchema } from "./trainingLoad.js";
import { dailyForecastsSchema, dailyWeatherSchema } from "./weather.js";
import { bikeWorkoutSchema } from "./workout.js";

/** A calendar date in `YYYY-MM-DD` form. */
export const planDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/**
 * One dated body-composition value the coach found in the athlete's input, such
 * as a weight or body-fat percentage stated in the profile or a comment. Either
 * value may be missing, because a statement rarely gives both. A point with
 * neither value is ignored.
 */
export const bodyMetricEstimateSchema = z.object({
  date: planDateSchema,
  /** Body weight in kilograms. */
  weightKg: z.number().positive().max(500).nullable().default(null),
  /** Body fat as a percentage of body weight. */
  bodyFatPercent: z.number().positive().max(75).nullable().default(null),
});

export type BodyMetricEstimate = z.infer<typeof bodyMetricEstimateSchema>;

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
  /** The athlete's estimated FTP at the current point in the season. */
  estimatedFtpWatts: z
    .number()
    .int()
    .nonnegative()
    .max(2000)
    .nullable()
    .optional(),
});

export type SeasonPlan = z.infer<typeof seasonPlanSchema>;

/** One week inside the active block plan. */
export const blockWeekSummarySchema = z.object({
  number: z.number().int().positive(),
  startDate: planDateSchema,
  focus: z.string().min(1),
  targetLoad: z.string().min(1),
  /**
   * The coach's estimate of the athlete's FTP for this week, based on their
   * stated FTP and the training completed so far. Null when the profile has no
   * FTP to anchor the estimate.
   */
  estimatedFtpWatts: z
    .number()
    .int()
    .nonnegative()
    .max(2000)
    .nullable()
    .optional(),
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
  /** The athlete's estimated FTP at the current point in the block. */
  estimatedFtpWatts: z
    .number()
    .int()
    .nonnegative()
    .max(2000)
    .nullable()
    .optional(),
});

export type BlockPlan = z.infer<typeof blockPlanSchema>;

/** One day in the current week's plan. */
export const weekSessionStatusSchema = z.enum([
  "completed",
  "partial",
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
   * Past days and today describe what actually happened (`completed`,
   * `partial`, `missed`, or `rest`); future days are `planned` unless they are
   * rest days.
   */
  status: weekSessionStatusSchema.default("planned"),
  /**
   * Whether the session is done outdoors. Missing means outdoor so plans stored
   * before weather planning still show weather when a forecast is available.
   */
  outdoor: z.boolean().optional(),
  /**
   * Whether the session could reasonably be done outdoors. False for sessions
   * tied to indoor equipment or a venue (trainer, treadmill, gym, pool). Missing
   * is treated as true so older plans still show the forecast.
   */
  canBeOutdoor: z.boolean().optional(),
  /**
   * Power targets for an indoor bike session, used to build a downloadable
   * trainer workout. Missing or null on every other kind of session.
   */
  bikeWorkout: bikeWorkoutSchema.nullable().optional(),
  /**
   * The forecast for this date from each source and their average. The
   * combined forecast is also stored in `weather` for older readers.
   */
  forecasts: dailyForecastsSchema.nullable().optional(),
  /** The combined forecast for this date, attached when a location is set. */
  weather: dailyWeatherSchema.nullable().optional(),
  /**
   * The coach's best estimate of this session's training stress score. Used
   * when the session has no measured power; a measured power activity replaces
   * it with the calculated value.
   */
  estimatedTss: z.number().nonnegative().max(2000).optional(),
  /**
   * The coach's estimate of the athlete's FTP on this day, used for the daily
   * projection on the Fitness page. The Week view still shows only the week's
   * single estimate. Null or missing for days before today.
   */
  estimatedFtpWatts: z
    .number()
    .int()
    .nonnegative()
    .max(2000)
    .nullable()
    .optional(),
  /**
   * Resolved training stress for the day plus the fitness and fatigue snapshot,
   * calculated after the coach responds. Missing on plans stored before
   * training-load tracking.
   */
  trainingLoad: trainingLoadSchema.nullable().optional(),
});

export type WeekSession = z.infer<typeof weekSessionSchema>;

/** The current week of the active block, with exactly seven sessions. */
export const weekPlanSchema = z.object({
  startDate: planDateSchema,
  focus: z.string().min(1),
  sessions: z.array(weekSessionSchema).length(7),
  /** The coach's explanation of this week's focus and load. */
  rationale: z.string().min(1),
  /**
   * The coach's estimate of the athlete's FTP for this week. Null when the
   * athlete has not provided an FTP to anchor the estimate.
   */
  estimatedFtpWatts: z
    .number()
    .int()
    .nonnegative()
    .max(2000)
    .nullable()
    .optional(),
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
  /**
   * Whether skipping this session costs little today. A session the coach cannot
   * justify toward the plan's goal should have been revised away, not marked
   * optional.
   */
  optional: z.boolean().default(false),
  /**
   * What the session builds toward the plan's goal and what skipping it would
   * cost; for an optional session, why that cost is acceptable today.
   */
  optionalRationale: z.string().min(1).optional(),
  /**
   * What happened on this day. Today is `completed` or `partial` when an
   * activity was recorded; otherwise it stays `planned`, or `rest` on rest days.
   */
  status: weekSessionStatusSchema.default("planned"),
  /** False for indoor sessions; missing is treated as outdoor. */
  outdoor: z.boolean().optional(),
  /**
   * Whether the session could reasonably be done outdoors. False for sessions
   * tied to indoor equipment or a venue (trainer, treadmill, gym, pool). Missing
   * is treated as true so older plans still show the forecast.
   */
  canBeOutdoor: z.boolean().optional(),
  /**
   * Power targets for an indoor bike session, used to build a downloadable
   * trainer workout. Missing or null on every other kind of session.
   */
  bikeWorkout: bikeWorkoutSchema.nullable().optional(),
  /**
   * The forecast for this date from each source and their average. The
   * combined forecast is also stored in `weather` for older readers.
   */
  forecasts: dailyForecastsSchema.nullable().optional(),
  /** The combined forecast for this date, attached when a location is set. */
  weather: dailyWeatherSchema.nullable().optional(),
  /**
   * The coach's best estimate of this session's training stress score. Used
   * when the session has no measured power.
   */
  estimatedTss: z.number().nonnegative().max(2000).optional(),
  /**
   * Resolved training stress for the day plus the fitness and fatigue snapshot.
   * Mirrored from the matching week session so Day and Week always agree.
   */
  trainingLoad: trainingLoadSchema.nullable().optional(),
});

export type DayPlan = z.infer<typeof dayPlanSchema>;

/** The complete four-level plan returned by an initial generation. */
export const coachPlanSchema = z
  .object({
    season: seasonPlanSchema,
    block: blockPlanSchema,
    week: weekPlanSchema,
    today: dayPlanSchema,
    /**
     * A suggested session for tomorrow. The coach fills this in so the UI can
     * show it after 18:00 without another generation.
     */
    tomorrow: dayPlanSchema.nullable().default(null),
    /**
     * The week containing tomorrow when it has crossed into a new week. It is
     * generated with tomorrow and promoted to `week` when the date reaches it.
     */
    nextWeek: weekPlanSchema.nullable().default(null),
    /**
     * The block that contains tomorrow when it falls after the current block.
     * Promoted to `block` when the date reaches it.
     */
    nextBlock: blockPlanSchema.nullable().default(null),
    /**
     * Body-composition points the coach found in the athlete's input, one per
     * date. Stored in the athlete metric series as coach estimates.
     */
    bodyMetrics: z.array(bodyMetricEstimateSchema).optional(),
  })
  .extend(coachResponseNotesSchema.shape);

export type CoachPlan = z.infer<typeof coachPlanSchema>;

/**
 * The first step of a full build: the season plan alone. Splitting the build
 * keeps each completion comfortably below the model's output budget.
 */
export const seasonPlanUpdateSchema = z
  .object({
    season: seasonPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type SeasonPlanUpdate = z.infer<typeof seasonPlanUpdateSchema>;

/** The second step of a full build: the first block of the season. */
export const initialBlockUpdateSchema = z
  .object({
    block: blockPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

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
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape)
  .refine(
    (value) =>
      value.week.sessions.some((session) => session.date === value.today.date),
    {
      message: "Today's session must be one of the week's sessions",
      path: ["today", "date"],
    },
  );

export type DailyPlanUpdate = z.infer<typeof dailyPlanUpdateSchema>;

/** The weekly build output: the new week plus a revised block plan. */
export const weeklyPlanUpdateSchema = z
  .object({
    week: weekPlanSchema,
    block: blockPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type WeeklyPlanUpdate = z.infer<typeof weeklyPlanUpdateSchema>;

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
  /** After 18:00, tomorrow has crossed into a week that is not planned yet. */
  nextWeek: z.boolean(),
  /** After 18:00, tomorrow has crossed into a block that is not planned yet. */
  nextBlock: z.boolean(),
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

/** How an explicit regeneration should treat the stored season. */
export const planGenerateModeSchema = z.enum([
  "auto",
  "newSeason",
  "updateSeason",
]);

export type PlanGenerateMode = z.infer<typeof planGenerateModeSchema>;

/** Request body of `POST /api/coaching/plan/generate`. */
export const planGenerateInputSchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
  /**
   * `auto` fills in whatever is missing and refreshes a stale existing season.
   * `newSeason` starts a fresh season today; `updateSeason` re-plans the rest of
   * the stored season from today.
   */
  mode: planGenerateModeSchema.default("auto"),
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

/** A one-off question the athlete asks the coach. */
export const quickQuestionRequestSchema = z.object({
  today: planDateSchema,
  question: z.string().min(1).max(2000),
});

export type QuickQuestionRequest = z.infer<typeof quickQuestionRequestSchema>;

/** Response body of `POST /api/coaching/questions`. */
export const quickQuestionResponseSchema = z.object({
  reply: coachAnalysisSchema.nullable().default(null),
});

export type QuickQuestionResponse = z.infer<typeof quickQuestionResponseSchema>;

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
  /** The commented activity's date, used to decide whether it is today's. */
  activityDate: planDateSchema,
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

/** A saved manual activity with the coach's latest reply, if any. */
export const manualActivitySchema = manualActivityInputSchema.extend({
  id: z.number().int().positive(),
  coachReply: coachAnalysisSchema.nullable().default(null),
  /** The coach's TSS estimate for this manual entry, when it has one. */
  estimatedTss: z.number().nonnegative().max(2000).nullable().optional(),
  /** Training stress for the day, when it can be derived. */
  trainingLoad: trainingLoadSchema.nullable().optional(),
});

export type ManualActivity = z.infer<typeof manualActivitySchema>;

/** Response body of `GET /api/coaching/activities/manual`. */
export const manualActivitiesResponseSchema = z.object({
  manualActivities: z.array(manualActivitySchema),
});

export type ManualActivitiesResponse = z.infer<
  typeof manualActivitiesResponseSchema
>;

/**
 * Response body of the coaching-input save endpoints (activity comment, manual
 * activity, weekly note). The reply is null when the coach could not answer.
 */
export const coachingInputSaveResponseSchema = z.object({
  message: z.string(),
  reply: coachAnalysisSchema.nullable().default(null),
});

export type CoachingInputSaveResponse = z.infer<
  typeof coachingInputSaveResponseSchema
>;

/** Response body of `GET /api/coaching/weekly/notes`. */
export const weeklyNoteResponseSchema = z.object({
  note: z.string().nullable(),
  reply: coachAnalysisSchema.nullable().default(null),
});

export type WeeklyNoteResponse = z.infer<typeof weeklyNoteResponseSchema>;
