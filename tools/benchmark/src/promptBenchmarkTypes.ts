import type { ReviseSeasonGates } from "./promptBenchmark.js";
import type { BenchmarkPromptId } from "./promptBenchmarkInput.js";

/** Token usage normalized from the provider's completion result. */
export interface PromptUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost: number | null;
}

/** One completion attempt, successful or failed. */
export interface PromptAttempt {
  startedAt: string;
  timeMs: number;
  httpStatus: number | null;
  finishReason: string | null;
  usage: PromptUsage | null;
  costUsd: number;
  raw: string;
  parsed: unknown;
  parseError: string | null;
  error: string | null;
}

/** The raw attempts for one prompt, written to `raw/<model>.json`. */
export interface PromptAttemptRecord {
  prompt: BenchmarkPromptId;
  attempts: PromptAttempt[];
}

/** The result of running one benchmark prompt against one model. */
export interface PromptRunResult {
  prompt: BenchmarkPromptId;
  attempts: PromptAttempt[];
  retryNeeded: boolean;
  ok: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
  plan: unknown;
  validationErrors: string[];
}

/** The result of running both benchmark prompts against one model. */
export interface PromptModelResult {
  id: string;
  name: string;
  requestedAt: string;
  prompts: Record<BenchmarkPromptId, PromptRunResult>;
  ok: boolean;
  /** True when the model reached the speed-F limit and stays ungraded. */
  expired?: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
}

/** The judge's verdict on one prompt response. */
export interface PromptJudge {
  score: number;
  components: Record<string, number>;
  note: string;
  judge: {
    model: string;
    attempts: number;
    timeMs: number;
    costUsd: number;
    error: string | null;
  };
}

/** Both prompt verdicts and their combined score for one model. */
export interface PromptJudgeScore extends PromptJudge {
  id: string;
  failed: boolean;
  gates: ReviseSeasonGates | null;
  prompts: Record<BenchmarkPromptId, PromptJudge>;
}

/** Optional hand-written replacement for one judge row. */
export interface PromptJudgeOverride {
  score?: number;
  note?: string;
}

/** Source run ids combined into one report, recorded in `sources.json`. */
export interface PromptBenchmarkSources {
  runIds?: unknown;
}
