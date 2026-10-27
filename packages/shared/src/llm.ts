import { z } from "zod";
import { activitySummarySchema, routePointSchema } from "./activity.js";
import { trainingLoadSchema } from "./trainingLoad.js";

/**
 * One model offered by the LLM provider, normalized for the model picker.
 * Prices are in USD per million tokens (null when the provider omits them).
 */
export const llmModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number().nullable().default(null),
  promptPricePerMillion: z.number().nullable().default(null),
  completionPricePerMillion: z.number().nullable().default(null),
});

export type LlmModel = z.infer<typeof llmModelSchema>;

/** Response body of `GET /api/llm/models`. */
export const llmModelsResponseSchema = z.object({
  models: z.array(llmModelSchema),
});

export type LlmModelsResponse = z.infer<typeof llmModelsResponseSchema>;

/**
 * Provider configuration as exposed to the client. The API key is deliberately
 * absent — only whether a key is stored and which model is selected.
 */
export const llmSettingsSchema = z.object({
  configured: z.boolean(),
  provider: z.string(),
  model: z.string().nullable(),
});

export type LlmSettings = z.infer<typeof llmSettingsSchema>;

/**
 * Request body for `PUT /api/llm/settings`. `apiKey` may be omitted when a key
 * is already stored (the client only sends it when rotating the key).
 */
export const llmSettingsUpdateSchema = z.object({
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1),
});

export type LlmSettingsUpdate = z.infer<typeof llmSettingsUpdateSchema>;

/** A coach's analysis of one activity, persisted so revisits are cheap. */
export const coachAnalysisSchema = z.object({
  text: z.string(),
  model: z.string(),
  generatedAt: z.string().datetime(),
});

export type CoachAnalysis = z.infer<typeof coachAnalysisSchema>;

/**
 * A synced activity plus its coach analysis. `analysis` is null when generation
 * failed for this activity; `analysisError` then carries the reason.
 *
 * Only the activity summary is returned: the timeseries is used server-side to
 * build the prompt, and the page only needs its sample count.
 */
export const analyzedActivitySchema = activitySummarySchema.extend({
  sampleCount: z.number().int().nonnegative().default(0),
  /**
   * A downsampled GPS trace for the route preview. Absent for activities
   * without position data (for example indoor sessions).
   */
  route: z.array(routePointSchema).optional(),
  analysis: coachAnalysisSchema.nullable().default(null),
  analysisError: z.string().nullable().default(null),
  /**
   * How the activity fit the athlete's training program, generated after a full
   * plan build. Null until the plan has been rebuilt with program context.
   */
  programAnalysis: coachAnalysisSchema.nullable().default(null),
  /** The athlete's saved comment on the activity, if any. */
  comment: z.string().nullable().default(null),
  /** The coach's latest reply to that comment, if any. */
  coachReply: coachAnalysisSchema.nullable().default(null),
  /** The athlete dismissed the activity with "No comment". */
  reviewed: z.boolean().optional(),
  /**
   * Training stress and the fitness snapshot for the activity's day. Derived
   * when the feed is served; absent on cached payloads from before the field
   * existed.
   */
  trainingLoad: trainingLoadSchema.nullable().optional(),
});

export type AnalyzedActivity = z.infer<typeof analyzedActivitySchema>;

/**
 * Response body of `GET /api/coaching/activities`. `model` is null when no LLM
 * is configured yet; activities are still returned, without analyses.
 */
export const analyzedActivitiesResponseSchema = z.object({
  model: z.string().nullable(),
  activities: z.array(analyzedActivitySchema),
});

export type AnalyzedActivitiesResponse = z.infer<
  typeof analyzedActivitiesResponseSchema
>;
