import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planDateSchema } from "@killingit/shared";
import { addDays, startOfWeek } from "../plans/dates.js";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const DEFAULT_OUTPUT = resolve(REPO_ROOT, "benchmarks/llm-coach/runs");
const RUN_ID = /^[a-zA-Z0-9._-]+$/;

export interface BenchmarkConfig {
  models: string[];
  userId: number | null;
  today: string;
  refreshToday: string;
  outputRoot: string;
  runId: string;
  scoresPath: string | null;
  reportOnlyDir: string | null;
  help: boolean;
}

export const BENCHMARK_HELP = `Usage:
  bun run benchmark:llm [options] <model> [<model> ...]
  bun run benchmark:llm --models-file models.txt [options]

The first model is the benchmark; the report compares every other model with it.

Options:
  --models-file <path>   Read one model id per line. Blank lines and lines
                         starting with # are ignored.
  --user-id <id>         Athlete account to benchmark. Defaults to the only
                         user in the database; required when there are several.
  --today <YYYY-MM-DD>   Planning day for the full build. Defaults to today in
                         UTC.
  --refresh-today <date> Planning day for the new-week refresh. Defaults to the
                         Monday after --today.
  --output <dir>         Root output directory. Defaults to
                         benchmarks/llm-coach/runs.
  --run-id <id>          Directory name for this run. Defaults to a UTC
                         timestamp.
  --scores <path>        JSON quality scores to include in the report. Shape:
                         { "<model>": { "quality": 8.5, "notes": "..." } }
  --report-only <dir>    Do not call any model; rebuild <dir>/report.md from
                         results.json and (optionally) --scores.
  --help                 Show this help.

Environment:
  DATABASE_URL           Database holding the athlete's real context.
  BENCHMARK_API_KEY      OpenRouter key. Preferred.
  LLM_CREDENTIALS_KEY    Used only when BENCHMARK_API_KEY is unset: decrypts the
                         account's stored OpenRouter key.
  OPENROUTER_API_URL     Optional provider override.

The runner is read-only: it uses the athlete's survey answers, cached activity
feed, coaching inputs and completed-period reviews, but writes plans only to the
run directory. No weather is loaded because the benchmark deliberately avoids
location-specific calls.
`;

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseDate(value: string, flag: string): string {
  const parsed = planDateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${flag} must be a valid YYYY-MM-DD date`);
  }
  return parsed.data;
}

function defaultRefreshDay(today: string): string {
  return addDays(startOfWeek(today), 7);
}

async function readModelsFile(path: string): Promise<string[]> {
  const text = await readFile(resolve(process.cwd(), path), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    if (model === "") continue;
    if (seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}

/**
 * Parses the command line into a benchmark configuration. Kept pure and
 * exported so the argument contract can be tested without running a benchmark.
 */
export async function parseBenchmarkArgs(
  argv: readonly string[],
): Promise<BenchmarkConfig> {
  const args = [...argv];
  const positional: string[] = [];
  let modelsFile: string | null = null;
  let userId: number | null = null;
  let today = new Date().toISOString().slice(0, 10);
  let refreshToday: string | null = null;
  let outputRoot = DEFAULT_OUTPUT;
  let runId = new Date().toISOString().replace(/[:.]/g, "-");
  let scoresPath: string | null = null;
  let reportOnlyDir: string | null = null;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--models-file":
        modelsFile = requiredValue(args, index, arg);
        index += 1;
        break;
      case "--user-id": {
        const value = Number(requiredValue(args, index, arg));
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error("--user-id must be a positive integer");
        }
        userId = value;
        index += 1;
        break;
      }
      case "--today":
        today = parseDate(requiredValue(args, index, arg), arg);
        index += 1;
        break;
      case "--refresh-today":
        refreshToday = parseDate(requiredValue(args, index, arg), arg);
        index += 1;
        break;
      case "--output":
        outputRoot = resolve(process.cwd(), requiredValue(args, index, arg));
        index += 1;
        break;
      case "--run-id":
        runId = requiredValue(args, index, arg);
        if (!RUN_ID.test(runId)) {
          throw new Error(
            "--run-id may only contain letters, numbers, dot, underscore and hyphen",
          );
        }
        index += 1;
        break;
      case "--scores":
        scoresPath = resolve(process.cwd(), requiredValue(args, index, arg));
        index += 1;
        break;
      case "--report-only":
        reportOnlyDir = resolve(process.cwd(), requiredValue(args, index, arg));
        index += 1;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  if (help) {
    return {
      models: [],
      userId,
      today,
      refreshToday: refreshToday ?? defaultRefreshDay(today),
      outputRoot,
      runId,
      scoresPath,
      reportOnlyDir,
      help: true,
    };
  }

  if (modelsFile !== null && positional.length > 0) {
    throw new Error("Use either --models-file or positional models, not both");
  }
  const models = uniqueModels(
    modelsFile === null ? positional : await readModelsFile(modelsFile),
  );
  if (reportOnlyDir === null && models.length === 0) {
    throw new Error("Provide at least one model, or use --models-file");
  }

  const effectiveRefresh =
    refreshToday === null ? defaultRefreshDay(today) : refreshToday;
  if (effectiveRefresh <= today) {
    throw new Error("--refresh-today must be after --today");
  }

  return {
    models,
    userId,
    today,
    refreshToday: effectiveRefresh,
    outputRoot,
    runId,
    scoresPath,
    reportOnlyDir,
    help: false,
  };
}
