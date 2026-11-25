import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

/** Default run directory name, kept for a run started without `RUN_ID`. */
const PROMPT_BENCHMARK_DEFAULT_RUN_ID = "2026-10-31-two-prompts";

/**
 * The catalog benchmark's run and report directories. They stay under
 * `benchmarks/prompts/` as git-ignored local output; see `benchmarks/README.md`.
 */
const PROMPT_BENCHMARK_RUNS_ROOT = resolve(
  REPO_ROOT,
  "benchmarks/prompts/runs",
);
export const PROMPT_BENCHMARK_REPORTS_ROOT = resolve(
  REPO_ROOT,
  "benchmarks/prompts/reports",
);

/** The run id every stage uses, from `RUN_ID`. */
export function promptBenchmarkRunId(): string {
  return process.env.RUN_ID?.trim() || PROMPT_BENCHMARK_DEFAULT_RUN_ID;
}

/** The run directory for one run id. */
export function promptBenchmarkRunDirectory(
  runId: string = promptBenchmarkRunId(),
): string {
  return resolve(PROMPT_BENCHMARK_RUNS_ROOT, runId);
}

/** The HTML report path for one run id. */
export function promptBenchmarkReportPath(
  runId: string = promptBenchmarkRunId(),
): string {
  return resolve(PROMPT_BENCHMARK_REPORTS_ROOT, `${runId}.html`);
}

/** A filesystem-safe file name for a model id. */
export function promptBenchmarkSlug(id: string): string {
  return id.replace(/[^a-zA-Z0-9.-]+/g, "_");
}

/** The prefix every prompt-benchmark stage logs with. */
export function logPromptBenchmark(message: string): void {
  console.log(`prompt-benchmark> ${message}`);
}
