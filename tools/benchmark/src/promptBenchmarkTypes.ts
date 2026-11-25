import { z } from "zod";
import {
  benchmarkPromptIdSchema,
  type BenchmarkPromptId,
} from "./promptBenchmarkInput.js";

/**
 * The stored shapes of the catalog benchmark's run files. Every stage reads
 * one of these files through `readJsonFile` in `jsonFile.ts`, so a renamed field
 * or a hand-edited file fails with the file name instead of reaching the report
 * as an unchecked cast.
 */

/**
 * Token usage normalized from the provider's completion result. It stays loose
 * because runs written before the provider normalization carry OpenRouter's
 * full usage object, and a later stage re-saves the parsed value.
 */
const promptUsageSchema = z.looseObject({
  prompt_tokens: z.number().nullable(),
  completion_tokens: z.number().nullable(),
  total_tokens: z.number().nullable(),
  cost: z.number().nullable(),
});

export type PromptUsage = z.infer<typeof promptUsageSchema>;

/** One completion attempt, successful or failed. */
const promptAttemptSchema = z.object({
  startedAt: z.string(),
  timeMs: z.number(),
  httpStatus: z.number().nullable(),
  finishReason: z.string().nullable(),
  usage: promptUsageSchema.nullable(),
  costUsd: z.number(),
  raw: z.string(),
  parsed: z.unknown(),
  parseError: z.string().nullable(),
  error: z.string().nullable(),
});

export type PromptAttempt = z.infer<typeof promptAttemptSchema>;

/** The raw attempts for one prompt, written to `raw/<model>.json`. */
export interface PromptAttemptRecord {
  prompt: BenchmarkPromptId;
  attempts: PromptAttempt[];
}

/** The result of running one benchmark prompt against one model. */
const promptRunResultSchema = z.object({
  prompt: benchmarkPromptIdSchema,
  attempts: z.array(promptAttemptSchema),
  retryNeeded: z.boolean(),
  ok: z.boolean(),
  totalTimeMs: z.number(),
  totalCostUsd: z.number(),
  plan: z.unknown(),
  validationErrors: z.array(z.string()),
});

export type PromptRunResult = z.infer<typeof promptRunResultSchema>;

/** The result of running both benchmark prompts against one model. */
export const promptModelResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  requestedAt: z.string(),
  /**
   * A partial record because a run written before the goal-steering prompt
   * existed has only the two core prompts, and report/sync must still read it.
   */
  prompts: z.partialRecord(benchmarkPromptIdSchema, promptRunResultSchema),
  ok: z.boolean(),
  /**
   * True when the model reached the speed-F limit and stays ungraded. Absent in
   * a run stored before the limit existed.
   */
  expired: z.boolean().optional(),
  totalTimeMs: z.number(),
  totalCostUsd: z.number(),
});

export type PromptModelResult = z.infer<typeof promptModelResultSchema>;

/**
 * The three hard gates the season revision applies to ability. A failed gate
 * grades the model F no matter what the judge thought of the plan.
 */
const reviseSeasonGatesSchema = z.object({
  atlasMentioned: z.boolean(),
  blockOneChanged: z.boolean(),
  blockOneStartDateKept: z.boolean(),
  /**
   * The model asked about Atlas instead of planning it into block 1. Absent in
   * a score stored before the gate was added.
   */
  atlasQuestionAsked: z.boolean().optional(),
  failures: z.array(z.string()),
});

export type ReviseSeasonGates = z.infer<typeof reviseSeasonGatesSchema>;

/** The judge's verdict on one prompt response. */
const promptJudgeSchema = z.object({
  score: z.number(),
  components: z.record(z.string(), z.number()),
  note: z.string(),
  judge: z.object({
    model: z.string(),
    attempts: z.number(),
    timeMs: z.number(),
    costUsd: z.number(),
    error: z.string().nullable(),
  }),
});

export type PromptJudge = z.infer<typeof promptJudgeSchema>;

/** Both prompt verdicts and their combined score for one model. */
export const promptJudgeScoreSchema = z.object({
  ...promptJudgeSchema.shape,
  id: z.string(),
  failed: z.boolean(),
  gates: reviseSeasonGatesSchema.nullable(),
  /** Partial for the same reason as a model result's prompts record. */
  prompts: z.partialRecord(benchmarkPromptIdSchema, promptJudgeSchema),
});

export type PromptJudgeScore = z.infer<typeof promptJudgeScoreSchema>;

/** Optional hand-written replacement for one judge row. */
const promptJudgeOverrideSchema = z.object({
  score: z.number().optional(),
  note: z.string().optional(),
});

/** Hand-written replacements for judge rows, recorded in `overrides.json`. */
export const promptJudgeOverridesSchema = z.record(
  z.string(),
  promptJudgeOverrideSchema,
);

/** Source run ids combined into one report, recorded in `sources.json`. */
export const promptBenchmarkSourcesSchema = z.object({
  runIds: z.array(z.string()).optional(),
});

export type PromptBenchmarkSources = z.infer<
  typeof promptBenchmarkSourcesSchema
>;
