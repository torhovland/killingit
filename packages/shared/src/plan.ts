import { z } from "zod";
import { coachAnalysisSchema, coachResponseNotesSchema } from "./llm.js";
import { athleteEventSchema } from "./event.js";
import { planDateSchema } from "./date.js";
import {
  calorieBreakdownSchema,
  dietPlanSchema,
  dietProgressSchema,
} from "./diet.js";
import { thresholdSummarySchema } from "./metrics.js";
import { trainingLoadSchema } from "./trainingLoad.js";
import { dailyForecastsSchema, dailyWeatherSchema } from "./weather.js";
import { bikeWorkoutSchema } from "./workout.js";

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
 * How important a dated goal is when goals compete for the same weeks. All
 * goals default to A; the coach may rank one lower when the athlete says so or
 * the coaching situation justifies it.
 */
const goalPrioritySchema = z.enum(["A", "B", "C"]);

export type GoalPriority = z.infer<typeof goalPrioritySchema>;

/** One dated goal the coach plans the season around. */
const seasonGoalSchema = z.object({
  /** A short name the athlete would recognise. */
  title: z.string().trim().min(1).max(120),
  /**
   * The date the goal is achieved, or the latest date in the period the
   * athlete gave when only a month or year is known.
   */
  date: planDateSchema,
  /**
   * The athlete's own wording when the date is not an exact day, such as
   * "August 2027". The date above is then a planning anchor, not a claim
   * about the exact day.
   */
  dateText: z.string().trim().min(1).max(80).nullable().optional(),
  priority: goalPrioritySchema,
  /** The outcome the coach is planning toward, in the athlete's terms. */
  target: z.string().trim().min(1),
});

export type SeasonGoal = z.infer<typeof seasonGoalSchema>;

/**
 * What a block does for one goal that is still ahead. `build` develops the
 * goal, `maintain` keeps the qualities it needs, and `accept-decline` says
 * plainly that the block prioritises another goal and what that costs.
 */
const blockSubGoalRoleSchema = z.enum(["build", "maintain", "accept-decline"]);

export type BlockSubGoalRole = z.infer<typeof blockSubGoalRoleSchema>;

/** One coach-defined goal milestone inside a block. */
const blockSubGoalSchema = z.object({
  /** The title of the matching goal in the season's `goals` list. */
  goalTitle: z.string().trim().min(1).max(120),
  /** The matching goal's date, so a goal title cannot drift between levels. */
  goalDate: planDateSchema,
  role: blockSubGoalRoleSchema,
  /** A measurable milestone the coach believes this block can reach. */
  target: z.string().trim().min(1),
  /** The date inside this block by which the target should be reached. */
  byDate: planDateSchema,
});

export type BlockSubGoal = z.infer<typeof blockSubGoalSchema>;

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
  /**
   * What the block does for every goal still ahead. Missing on plans stored
   * before the goal ledger existed; a generated season always carries it.
   */
  subGoals: z.array(blockSubGoalSchema).optional(),
  /**
   * The coach's expected weight and body fat at the end of this block. Null or
   * missing when diet advice is off, no goal was stated, or the plan predates
   * diet progress targets.
   */
  dietProgress: dietProgressSchema.nullable().optional(),
});

export type SeasonBlockSummary = z.infer<typeof seasonBlockSummarySchema>;

/** The high-level season: goal, dates, and the ordered blocks that build to it. */
export const seasonPlanSchema = z.object({
  goal: z.string().min(1),
  /**
   * The coach's greeting when the season is first planned: who they are and how
   * much they look forward to working with the athlete. Missing on plans stored
   * before the introduction existed.
   */
  introduction: z.string().min(1).nullable().optional(),
  startDate: planDateSchema,
  endDate: planDateSchema,
  /**
   * Every dated goal the coach is planning around, in date order. Missing on
   * plans stored before the goal ledger existed.
   */
  goals: z.array(seasonGoalSchema).optional(),
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
  /**
   * The coach's expected weight and body fat at the end of the season. Null or
   * missing when diet advice is off, no goal was stated, or the plan predates
   * diet progress targets.
   */
  dietProgress: dietProgressSchema.nullable().optional(),
});

export type SeasonPlan = z.infer<typeof seasonPlanSchema>;

/** One week inside the active block plan. */
const blockWeekSummarySchema = z.object({
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
  /**
   * The coach's expected weight and body fat at the end of this week. Null or
   * missing when diet advice is off, no goal was stated, or the plan predates
   * diet progress targets.
   */
  dietProgress: dietProgressSchema.nullable().optional(),
});

export type BlockWeekSummary = z.infer<typeof blockWeekSummarySchema>;

/** The detailed plan for the block currently in progress. */
export const blockPlanSchema = z.object({
  name: z.string().min(1),
  focus: z.string().min(1),
  startDate: planDateSchema,
  endDate: planDateSchema,
  weeks: z.array(blockWeekSummarySchema).min(1),
  /**
   * What this block does for every goal still ahead. It matches the season
   * block summary; missing on plans stored before the goal ledger existed.
   */
  subGoals: z.array(blockSubGoalSchema).optional(),
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
  /**
   * The coach's expected weight and body fat at the end of the block. Null or
   * missing when diet advice is off, no goal was stated, or the plan predates
   * diet progress targets.
   */
  dietProgress: dietProgressSchema.nullable().optional(),
});

export type BlockPlan = z.infer<typeof blockPlanSchema>;

/** One day in the current week's plan. */
const weekSessionStatusSchema = z.enum([
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
   * The coach's estimate of the calories this day needs to keep the athlete on
   * track for their diet goal. Missing on plans stored before diet coaching.
   * When a `calorieBreakdown` is present its sum is the authoritative allocated
   * intake, so this field is kept for older plans and as the coach's own total.
   */
  estimatedCaloriesKcal: z.number().int().nonnegative().max(20000).optional(),
  /**
   * The coach's breakdown of the day's calorie allocation: base metabolism plus
   * the workout requirement minus the diet deficit. Missing on plans stored
   * before the breakdown existed.
   */
  calorieBreakdown: calorieBreakdownSchema.nullable().optional(),
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
  /**
   * The coach's expected weight and body fat at the end of this week. Null or
   * missing when diet advice is off, no goal was stated, or the plan predates
   * diet progress targets.
   */
  dietProgress: dietProgressSchema.nullable().optional(),
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
   * cost; for an optional session, why that cost is acceptable today. A blank
   * value means the coach had nothing to add, which is common on a rest day and
   * must not reject the whole plan.
   */
  optionalRationale: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(1).optional(),
  ),
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
   * The coach's estimate of the calories this day needs to keep the athlete on
   * track for their diet goal. Missing on plans stored before diet coaching.
   * When a `calorieBreakdown` is present its sum is the authoritative allocated
   * intake, so this field is kept for older plans and as the coach's own total.
   */
  estimatedCaloriesKcal: z.number().int().nonnegative().max(20000).optional(),
  /**
   * The coach's breakdown of the day's calorie allocation: base metabolism plus
   * the workout requirement minus the diet deficit. Missing on plans stored
   * before the breakdown existed.
   */
  calorieBreakdown: calorieBreakdownSchema.nullable().optional(),
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
    /**
     * The athlete's diet goal and the coach's judgement of the tracked weight
     * trend. Missing on plans stored before diet coaching.
     */
    diet: dietPlanSchema.nullable().optional(),
  })
  .extend(coachResponseNotesSchema.shape);

export type CoachPlan = z.infer<typeof coachPlanSchema>;

/**
 * Progress reported while the coach is generating. `progress` is a percentage
 * (0–100) so the UI can render a determinate bar.
 */
const planGenerationStatusSchema = z.object({
  status: z.enum(["idle", "running", "done", "error"]),
  step: z.string().nullable(),
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  /** Identifies the run that owns this status; a newer run replaces it. */
  runId: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type PlanGenerationStatus = z.infer<typeof planGenerationStatusSchema>;

/** Which parts of the stored plan are missing for today's date. */
const planPendingSchema = z.object({
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
  /**
   * The athlete stated a diet goal but a current or future period is missing its
   * diet progress target.
   */
  dietProgress: z.boolean(),
});

export type PlanPending = z.infer<typeof planPendingSchema>;

/** Response body of `GET /api/coaching/plan`. */
export const coachPlanResponseSchema = z.object({
  plan: coachPlanSchema.nullable(),
  generatedAt: z.string().datetime().nullable(),
  generation: planGenerationStatusSchema,
  stale: z.boolean(),
  pending: planPendingSchema,
  /** Every threshold measure currently known about the athlete. */
  thresholds: z.array(thresholdSummarySchema).default([]),
  /** Dated goals and events the athlete stated, for the Day and Week tabs. */
  events: z.array(athleteEventSchema).default([]),
});

export type CoachPlanResponse = z.infer<typeof coachPlanResponseSchema>;

/** How an explicit regeneration should treat the stored season. */
const planGenerateModeSchema = z.enum(["auto", "newSeason", "updateSeason"]);

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
const manualActivityInputSchema = z.object({
  startDate: planDateSchema,
  details: z.string().min(1).max(2000),
});

export type ManualActivityInput = z.infer<typeof manualActivityInputSchema>;

/** A comment the athlete added to an activity. */
export type ActivityCommentInput = {
  activityId: string;
  comment: string;
};

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
const manualActivitySchema = manualActivityInputSchema.extend({
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
