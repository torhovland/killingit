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

/**
 * The coaching task a prompt belongs to. Stored with every LLM call so the
 * admin prompt log can label and filter calls without re-reading the prompt.
 */
export const LLM_PROMPT_KINDS = [
  "coach_plan",
  "season_plan",
  "initial_block",
  "daily_update",
  "target_day_update",
  "weekly_update",
  "season_refresh",
  "block_update",
  "activity_analysis",
  "program_analysis",
  "coach_reply",
  "coaching_question",
  "period_review",
  "manual_tss",
  "other",
] as const;

export const llmPromptKindSchema = z.enum(LLM_PROMPT_KINDS);

export type LlmPromptKind = z.infer<typeof llmPromptKindSchema>;

/** Human-readable labels for the prompt types shown in the admin log. */
export const LLM_PROMPT_KIND_LABELS: Record<LlmPromptKind, string> = {
  coach_plan: "Full coach plan",
  season_plan: "Season plan",
  initial_block: "Initial block",
  daily_update: "Daily update",
  target_day_update: "Target day update",
  weekly_update: "Weekly update",
  season_refresh: "Season refresh",
  block_update: "Block update",
  activity_analysis: "Activity analysis",
  program_analysis: "Program analysis",
  coach_reply: "Coach reply",
  coaching_question: "Coaching question",
  period_review: "Period review",
  manual_tss: "Manual activity TSS",
  other: "Other",
};

/** One message sent to the provider, as stored in the prompt log. */
export const llmCallMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type LlmCallMessage = z.infer<typeof llmCallMessageSchema>;

/** Token usage reported by the provider, when it includes it. */
export const llmCallUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export type LlmCallUsage = z.infer<typeof llmCallUsageSchema>;

/** A logged LLM request without its (potentially large) prompt and response. */
export const llmCallSummarySchema = z.object({
  id: z.number().int().positive(),
  createdAt: z.string().datetime(),
  userId: z.number().int().positive(),
  /** The account's auth subject, the best human identifier we store. */
  userLabel: z.string(),
  kind: llmPromptKindSchema,
  provider: z.string(),
  model: z.string(),
  durationMs: z.number().int().nonnegative(),
  failed: z.boolean(),
});

export type LlmCallSummary = z.infer<typeof llmCallSummarySchema>;

/** Response body of `GET /api/admin/llm-calls`. */
export const llmCallsResponseSchema = z.object({
  calls: z.array(llmCallSummarySchema),
});

export type LlmCallsResponse = z.infer<typeof llmCallsResponseSchema>;

/**
 * One full LLM call for the admin detail view: the exact messages sent, the
 * response (or error), token usage, and request metadata such as temperature,
 * output budget, and retry attempt.
 */
export const llmCallDetailSchema = llmCallSummarySchema.extend({
  messages: z.array(llmCallMessageSchema),
  response: z.string().nullable(),
  error: z.string().nullable(),
  usage: llmCallUsageSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export type LlmCallDetail = z.infer<typeof llmCallDetailSchema>;

/** A coach's analysis of one activity, persisted so revisits are cheap. */
export const coachAnalysisSchema = z.object({
  text: z.string(),
  model: z.string(),
  generatedAt: z.string().datetime(),
});

/**
 * The structured response the coach returns for an activity analysis. The
 * visible analysis stays plain text, while the FTP estimate is persisted as a
 * coach-sourced point in the athlete's FTP time series.
 */
export const coachAnalysisResultSchema = z.object({
  analysis: z.string().trim().min(1),
  estimatedFtpWatts: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .nullable()
    .default(null),
});

export type CoachAnalysisResult = z.infer<typeof coachAnalysisResultSchema>;

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
