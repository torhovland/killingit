import { z } from "zod";
import {
  activitySampleSchema,
  activitySummarySchema,
  routePointSchema,
} from "./activity.js";
import { trainingLoadSchema } from "./trainingLoad.js";

/**
 * One model offered by the LLM provider, normalized for the model picker.
 * Prices are in USD per million tokens (null when the provider omits them).
 */
export const llmModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** For alias ids such as `~provider/model-latest`, the concrete target. */
  aliasTargetSlug: z.string().nullable().default(null),
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

/** Letter grade used by the model catalog. `?` means not benchmarked yet. */
export const llmModelGradeSchema = z.enum([
  "A+",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "?",
]);

export type LlmModelGrade = z.infer<typeof llmModelGradeSchema>;

/** One graded model in the account's model picker. */
export const llmCatalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  retired: z.boolean(),
  discouraged: z.boolean(),
  ability: llmModelGradeSchema,
  speed: llmModelGradeSchema,
  cost: llmModelGradeSchema,
  benchmarkScore: z.number().nullable(),
  benchmarkTimeMs: z.number().nullable(),
  benchmarkCostUsd: z.number().nullable(),
  /** When the benchmark last scored this model, or null if ungraded. */
  benchmarkedAt: z.string().datetime().nullable(),
});

export type LlmCatalogModel = z.infer<typeof llmCatalogModelSchema>;

/** Response body of `GET /api/llm/catalog`. */
export const llmCatalogResponseSchema = z.object({
  models: z.array(llmCatalogModelSchema),
});

export type LlmCatalogResponse = z.infer<typeof llmCatalogResponseSchema>;

/**
 * Provider configuration as exposed to the client. The API key is deliberately
 * absent — only whether a key is stored and which models are selected.
 */
export const llmSettingsSchema = z.object({
  configured: z.boolean(),
  provider: z.string(),
  model: z.string().nullable(),
  seasonModel: z.string().nullable().default(null),
  dailyModel: z.string().nullable().default(null),
});

export type LlmSettings = z.infer<typeof llmSettingsSchema>;

/**
 * Request body for `PUT /api/llm/settings`. `apiKey` may be omitted when a key
 * is already stored (the client only sends it when rotating the key), and the
 * model fields may be omitted when both are already stored. A key-only update
 * is what the Settings key section sends when rotating a key.
 */
export const llmSettingsUpdateSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    /** Legacy single-model field; used for both roles when supplied alone. */
    model: z.string().min(1).optional(),
    seasonModel: z.string().min(1).optional(),
    dailyModel: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.apiKey !== undefined ||
      value.model !== undefined ||
      (value.seasonModel !== undefined && value.dailyModel !== undefined),
    {
      message:
        "Provide an apiKey, seasonModel and dailyModel, or the legacy model field",
    },
  )
  .refine(
    (value) =>
      (value.seasonModel === undefined) === (value.dailyModel === undefined),
    {
      message: "Provide both seasonModel and dailyModel, or neither",
    },
  );

export type LlmSettingsUpdate = z.infer<typeof llmSettingsUpdateSchema>;

/**
 * The coaching task a prompt belongs to. Stored with every LLM call so the
 * admin prompt log can label and filter calls without re-reading the prompt.
 */
export const LLM_PROMPT_KINDS = [
  "coach_plan",
  "season_plan",
  "initial_block",
  "plan_update",
  "daily_update",
  "target_day_update",
  "weekly_update",
  "season_refresh",
  "block_update",
  "activity_analysis",
  "program_analysis",
  "athlete_metrics",
  "athlete_events",
  "athlete_reading",
  "coach_reply",
  "coaching_question",
  "period_review",
  "manual_tss",
  "food_analysis",
  "other",
] as const;

export const llmPromptKindSchema = z.enum(LLM_PROMPT_KINDS);

export type LlmPromptKind = z.infer<typeof llmPromptKindSchema>;

/** Human-readable labels for the prompt types shown in the admin log. */
export const LLM_PROMPT_KIND_LABELS: Record<LlmPromptKind, string> = {
  coach_plan: "Full coach plan",
  season_plan: "Season plan",
  initial_block: "Initial block",
  plan_update: "Plan update",
  daily_update: "Daily update",
  target_day_update: "Target day update",
  weekly_update: "Weekly update",
  season_refresh: "Season refresh",
  block_update: "Block update",
  activity_analysis: "Activity analysis",
  program_analysis: "Program analysis",
  athlete_metrics: "Athlete metrics",
  athlete_events: "Athlete goals and events",
  athlete_reading: "Athlete readings",
  coach_reply: "Coach reply",
  coaching_question: "Coaching question",
  period_review: "Period review",
  manual_tss: "Manual activity TSS",
  food_analysis: "Food analysis",
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
  /**
   * The amount OpenRouter charged for the request, in USD. Older call rows
   * predate cost capture and have no value here.
   */
  costUsd: z.number().nonnegative().nullable().optional(),
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
  /**
   * The provider has not settled yet. A row left pending long after its run
   * ended belongs to a process that stopped mid-call.
   */
  pending: z.boolean(),
  /** The JSON repair turn that followed a rejected plan response. */
  repair: z.boolean(),
  /** The provider attempt that produced this row, when it was part of a chain. */
  attempt: z.number().int().positive().nullable(),
  ofAttempts: z.number().int().positive().nullable(),
  /** The plan generation this prompt belongs to ended in failure. */
  planFailed: z.boolean(),
});

export type LlmCallSummary = z.infer<typeof llmCallSummarySchema>;

/** Response body of `GET /api/admin/llm-calls`. */
export const llmCallsResponseSchema = z.object({
  calls: z.array(llmCallSummarySchema),
});

export type LlmCallsResponse = z.infer<typeof llmCallsResponseSchema>;

/**
 * The cost of one model's calls in one period. Monthly buckets use
 * `YYYY-MM` and daily buckets use `YYYY-MM-DD`, both in UTC.
 */
export const llmCostBucketSchema = z.object({
  bucket: z.string().min(1),
  /** The routed model id, used as the stack's stable key. */
  model: z.string().min(1),
  /** The catalog's display name, or the model id when it is not in the catalog. */
  label: z.string().min(1),
  /** The coaching task the prompt belonged to, such as a season plan or a review. */
  kind: llmPromptKindSchema,
  costUsd: z.number().nonnegative(),
  calls: z.number().int().nonnegative(),
});

export type LlmCostBucket = z.infer<typeof llmCostBucketSchema>;

/** Response body of `GET /api/llm/costs`, aggregated per month and per day. */
export const llmCostsResponseSchema = z.object({
  monthly: z.array(llmCostBucketSchema),
  daily: z.array(llmCostBucketSchema),
});

export type LlmCostsResponse = z.infer<typeof llmCostsResponseSchema>;

/** One non-null `modelsRemarks` value from a recent prompt log entry. */
export const llmModelRemarkSchema = z.object({
  callId: z.number().int().positive(),
  createdAt: z.string().datetime(),
  userId: z.number().int().positive(),
  userLabel: z.string(),
  kind: llmPromptKindSchema,
  model: z.string(),
  remarks: z.string(),
});

export type LlmModelRemark = z.infer<typeof llmModelRemarkSchema>;

export const llmModelRemarksResponseSchema = z.object({
  remarks: z.array(llmModelRemarkSchema),
});

export type LlmModelRemarksResponse = z.infer<
  typeof llmModelRemarksResponseSchema
>;

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
  /**
   * The coach judged that this input changes the plan. Absent on analyses
   * stored before the flag existed.
   */
  planChangeNeeded: z.boolean().optional(),
});

/**
 * Extra notes every structured coach response may carry. The clarification
 * question is shown to the athlete; model remarks are reviewed by the admin.
 */
export const coachResponseNotesSchema = z.object({
  /** One important clarification question for the athlete, or null. */
  coachQuestion: z.string().trim().min(1).nullable().optional(),
  /** Problems, inconsistencies or objections the model hit, or null. */
  modelsRemarks: z.string().trim().min(1).nullable().optional(),
});

export type CoachResponseNotes = z.infer<typeof coachResponseNotesSchema>;

/**
 * The structured response the coach returns for an activity analysis. The
 * visible analysis stays plain text, while the FTP estimate is persisted as a
 * coach-sourced point in the athlete's FTP time series. Body weight and body-fat
 * values the athlete stated for the activity are stored the same way.
 */
export const coachAnalysisResultSchema = z
  .object({
    analysis: z.string().trim().min(1),
    estimatedFtpWatts: z
      .number()
      .int()
      .min(50)
      .max(2000)
      .nullable()
      .default(null),
    /** Body weight in kilograms when the activity's input states it. */
    weightKg: z.number().positive().max(500).nullable().default(null),
    /** Body fat as a percentage of body weight when the input states it. */
    bodyFatPercent: z.number().positive().max(75).nullable().default(null),
    /**
     * Whether this workout changes what the coach would prescribe. Fails open:
     * a missing or malformed flag is treated as a request to refresh, so an
     * unparsed answer cannot silently drop a needed revision.
     */
    planChangeNeeded: z.boolean().catch(true),
  })
  .extend(coachResponseNotesSchema.shape);

export type CoachAnalysisResult = z.infer<typeof coachAnalysisResultSchema>;

/**
 * The structured reply to one athlete input. `reply` is shown to the athlete;
 * `planChangeNeeded` decides whether the plan is refreshed. It fails open: a
 * missing or malformed flag is treated as true, so a model that ignores the
 * contract still refreshes the plan.
 */
export const coachReplyResultSchema = z.object({
  reply: z.string().trim().min(1),
  planChangeNeeded: z.boolean().catch(true),
});

export type CoachReplyResult = z.infer<typeof coachReplyResultSchema>;

export type CoachAnalysis = z.infer<typeof coachAnalysisSchema>;

/**
 * A synced activity plus its coach analysis. `analysis` is null when generation
 * failed for this activity; `analysisError` then carries the reason.
 *
 * The full-resolution timeseries stays server-side to build the prompt; the
 * page gets its sample count plus a downsampled preview of the recorded
 * channels.
 */
export const analyzedActivitySchema = activitySummarySchema.extend({
  sampleCount: z.number().int().nonnegative().default(0),
  /**
   * An evenly spaced, bounded preview of the recorded timeseries for the
   * sample table. Empty for activities without recorded samples.
   */
  samples: z.array(activitySampleSchema).default([]),
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
   * Training stress credited to this activity alone (measured power or a
   * duration-based fallback), distinct from the day's total in `trainingLoad`.
   * Absent on cached payloads from before the field existed.
   */
  activityTss: z.number().nonnegative().max(10000).nullable().optional(),
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
