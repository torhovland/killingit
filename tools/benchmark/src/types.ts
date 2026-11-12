import type { CoachPlan } from "@killingit/shared";

/** Token usage reported by OpenRouter for one completion. */
export interface BenchmarkUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  cost_details?: Record<string, number>;
}

export type BenchmarkStep = "season" | "block" | "week" | "day" | "unknown";

/** One HTTP completion, including fallback and repair attempts. */
export interface BenchmarkCall {
  step: BenchmarkStep;
  /** True when this was a JSON-repair turn. */
  repair: boolean;
  maxTokens: number;
  reasoning: unknown;
  startedAt: string;
  durationMs: number;
  httpStatus: number | null;
  finishReason: string | null;
  contentChars: number;
  usage: BenchmarkUsage | null;
  error: string | null;
}

/** The result of one full build or one week+day refresh. */
export interface BenchmarkRun {
  ok: boolean;
  wallMs: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  calls: BenchmarkCall[];
  plan: CoachPlan | null;
  error: string | null;
}

export interface BenchmarkModelResult {
  model: string;
  pricing: {
    promptPricePerMillion: number | null;
    completionPricePerMillion: number | null;
    contextLength: number | null;
  } | null;
  full: BenchmarkRun | null;
  refresh: BenchmarkRun | null;
  error: string | null;
}

export interface BenchmarkMetadata {
  runId: string;
  runAt: string;
  gitCommit: string | null;
  userId: number;
  today: string;
  refreshToday: string;
  benchmarkModel: string;
  models: string[];
  planMaxTokens: number;
  exclusions: string[];
}

export interface BenchmarkResults {
  metadata: BenchmarkMetadata;
  models: Record<string, BenchmarkModelResult>;
}

/** Optional hand-written quality assessment for one model. */
export interface BenchmarkScore {
  quality: number;
  notes: string;
}

export type BenchmarkScores = Record<string, BenchmarkScore>;
