import { runPromptBenchmarkFinalizeStage } from "./promptBenchmarkFinalize.js";
import { runPromptBenchmarkJudgeStage } from "./promptBenchmarkJudge.js";
import { runPromptBenchmarkReportStage } from "./promptBenchmarkReport.js";
import { runPromptBenchmarkRunStage } from "./promptBenchmarkRun.js";
import { runPromptBenchmarkShortlistStage } from "./promptBenchmarkShortlist.js";
import { runPromptBenchmarkSyncStage } from "./promptBenchmarkSync.js";

const STAGES = [
  "run",
  "judge",
  "finalize",
  "shortlist",
  "sync-db",
  "report",
] as const;

export const PROMPT_BENCHMARK_HELP = `Usage:
  bun run benchmark:prompts <stage>

Two-prompt model-catalog benchmark. Both prompts are built by the app's real
prompt builders and called through the app's LlmProvider.

Stages:
  run         Call both prompts for the selected models and write the run
              directory (models.json, raw/*.json, results.json).
  judge       Score every valid response with the judge model. Optional: the
              run stage alone produces results, and judging can run later.
  finalize    Recover responses rejected only for a warning-level contract
              issue such as an unexpected extra top-level key.
  shortlist   Print the top judged models with their today title and judgment.
  sync-db     Refresh the catalog, record the grades and copy aliases.
  report      Render <run-id>.html from results.json and judge-scores.json.

Environment:
  RUN_ID                       Run directory name.
  BENCHMARK_OPENROUTER_API_KEY Dedicated OpenRouter key.
  DATABASE_URL                 Catalog and athlete database.
  CONCURRENCY                  Parallel models (run: 10, judge: 15).
  PENDING_ONLY=1               Run only models with a ? grade.
  RESCORE_MIN_ABILITY=<grade>  Rescore that grade and above plus ungraded.
  RESCORE_COST_GRADE=<grade>   Rescore only that exact cost grade.
  INCLUDE_COST_GRADES=A,B,C    Rescore several exact cost grades.
  INCLUDE_MODELS=id1,id2       Force named models into the run.
  EXCLUDE_ABILITY_GRADES=F     Drop models with that ability grade.
  SORT=slowest                 Order slowest first by previous time.
  DRY_RUN=1                    Write models.json and make no calls.
  RETRY_FAILED=1               Re-run only unfinished prompts.
  ONLY_VALID=1                 Judge only models valid on both prompts.
  RETRY_FAILED_JUDGES=1        Re-judge unusable judge responses.
  SKIP_FAILED=1                Leave unfinished models at their previous grade.
  SKIP_REFRESH=1               Do not refresh the catalog before recording.
  JUDGE_MODEL=<id>             Judge model (default anthropic/claude-haiku-5.5).
  MAX_TOKENS, MAX_TOKENS_REVISE, TIMEOUT_MS, LIMIT
  SCORES_FILE, USE_OVERRIDES=0 Report overrides.

Run directories and reports are git-ignored local output under
benchmarks/prompts/; see benchmarks/prompts/README.md and
docs/specs/llm-benchmark.md.`;

function stage(command: string): (() => Promise<void>) | null {
  switch (command) {
    case "run":
      return runPromptBenchmarkRunStage;
    case "judge":
      return runPromptBenchmarkJudgeStage;
    case "finalize":
      return runPromptBenchmarkFinalizeStage;
    case "shortlist":
      return runPromptBenchmarkShortlistStage;
    case "sync-db":
      return runPromptBenchmarkSyncStage;
    case "report":
      return runPromptBenchmarkReportStage;
    default:
      return null;
  }
}

/**
 * Runs one stage of the two-prompt benchmark. The stage is an explicit argument
 * so the CLI keeps the old scripts' separation while sharing one entry point.
 */
export async function runPromptBenchmarkCli(
  argv: readonly string[],
): Promise<void> {
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(PROMPT_BENCHMARK_HELP);
    return;
  }
  if (argv.length > 1) {
    throw new Error(`unexpected argument: ${argv[1]}`);
  }
  const selected = stage(command);
  if (selected === null) {
    throw new Error(
      `unknown stage: ${command}. Use one of ${STAGES.join(", ")} or --help.`,
    );
  }
  await selected();
}
