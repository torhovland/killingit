import { coachPlanSchema } from "@killingit/shared";
import { z } from "zod";

/**
 * The stored shapes of the plan comparison's run files. `cli.ts` reads
 * `results.json` and `scores.json` through these schemas, so a corrupt or
 * hand-edited run fails with the file name instead of reaching the report as an
 * unchecked cast. See `docs/specs/llm-benchmark.md`.
 */

/** Token usage reported by OpenRouter for one completion. */
const benchmarkUsageSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  cost: z.number().optional(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().optional(),
      cache_write_tokens: z.number().optional(),
    })
    .optional(),
  completion_tokens_details: z
    .object({
      reasoning_tokens: z.number().optional(),
    })
    .optional(),
  cost_details: z.record(z.string(), z.number()).optional(),
});

export type BenchmarkUsage = z.infer<typeof benchmarkUsageSchema>;

const benchmarkStepSchema = z.enum([
  "season",
  "block",
  "week",
  "day",
  "unknown",
]);

export type BenchmarkStep = z.infer<typeof benchmarkStepSchema>;

/** One HTTP completion, including fallback and repair attempts. */
const benchmarkCallSchema = z.object({
  step: benchmarkStepSchema,
  /** True when this was a JSON-repair turn. */
  repair: z.boolean(),
  maxTokens: z.number(),
  reasoning: z.unknown(),
  startedAt: z.string(),
  durationMs: z.number(),
  httpStatus: z.number().nullable(),
  finishReason: z.string().nullable(),
  contentChars: z.number(),
  usage: benchmarkUsageSchema.nullable(),
  error: z.string().nullable(),
});

export type BenchmarkCall = z.infer<typeof benchmarkCallSchema>;

/** The result of one full build or one week+day refresh. */
const benchmarkRunSchema = z.object({
  ok: z.boolean(),
  wallMs: z.number(),
  costUsd: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  reasoningTokens: z.number(),
  calls: z.array(benchmarkCallSchema),
  plan: coachPlanSchema.nullable(),
  error: z.string().nullable(),
});

export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>;

const benchmarkModelResultSchema = z.object({
  model: z.string(),
  pricing: z
    .object({
      promptPricePerMillion: z.number().nullable(),
      completionPricePerMillion: z.number().nullable(),
      contextLength: z.number().nullable(),
    })
    .nullable(),
  full: benchmarkRunSchema.nullable(),
  refresh: benchmarkRunSchema.nullable(),
  error: z.string().nullable(),
});

export type BenchmarkModelResult = z.infer<typeof benchmarkModelResultSchema>;

const benchmarkMetadataSchema = z.object({
  runId: z.string(),
  runAt: z.string(),
  gitCommit: z.string().nullable(),
  userId: z.number(),
  today: z.string(),
  refreshToday: z.string(),
  benchmarkModel: z.string(),
  models: z.array(z.string()),
  planMaxTokens: z.number(),
  exclusions: z.array(z.string()),
});

export type BenchmarkMetadata = z.infer<typeof benchmarkMetadataSchema>;

export const benchmarkResultsSchema = z.object({
  metadata: benchmarkMetadataSchema,
  models: z.record(z.string(), benchmarkModelResultSchema),
});

export type BenchmarkResults = z.infer<typeof benchmarkResultsSchema>;

/** Optional hand-written quality assessment for one model. */
const benchmarkScoreSchema = z.object({
  quality: z.number().min(0).max(10),
  notes: z.string(),
});

export type BenchmarkScore = z.infer<typeof benchmarkScoreSchema>;

export const benchmarkScoresSchema = z.record(z.string(), benchmarkScoreSchema);

export type BenchmarkScores = z.infer<typeof benchmarkScoresSchema>;
