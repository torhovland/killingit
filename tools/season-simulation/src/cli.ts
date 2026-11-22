import {
  assertDedicatedDatabase,
  MODEL_ID,
  OUTPUT_ROOT,
  SIM_DATABASE_URL,
} from "./config.js";
import { clearSimulationState } from "./state.js";
import type { ScenarioName } from "./types.js";

export interface CliOptions {
  scenarios: ScenarioName[];
  weekLimit: number | undefined;
  reportOnly: boolean;
  resume: boolean;
  suffix: string;
  help: boolean;
}

const HELP_TEXT = `Usage: bun run simulate:season [options]

Runs the season simulation against a dedicated PostgreSQL database, records
imported activities as the athlete completes the plan, and writes a PDF report.

Options:
  --scenario <full|reduced|both>  Which scenario to run (default: both).
  --weeks <n>                     Stop after n simulated weeks (smoke run).
  --resume                        Continue a saved run instead of rebuilding.
  --suffix <text>                 Suffix for the result files (default: none).
  --report-only                   Build the report from existing result files.
  --help                          Show this help.

Environment:
  BENCHMARK_OPENROUTER_API_KEY    Real model key used for every prompt.
  SEASON_SIM_DATABASE_URL         Dedicated database, name must end _season_sim.
  SEASON_SIM_MODEL                Model id (default: ${MODEL_ID}).

The harness rebuilds the simulation database before every scenario. It never
touches the development or production database.`;

/** Parses the CLI without touching a database or the network. */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    scenarios: ["full", "reduced"],
    weekLimit: undefined,
    reportOnly: false,
    resume: false,
    suffix: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--report-only") {
      options.reportOnly = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--scenario") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--scenario needs a value");
      options.scenarios = parseScenario(value);
      index += 1;
    } else if (arg === "--weeks") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--weeks needs a value");
      options.weekLimit = parseWeekLimit(value);
      index += 1;
    } else if (arg === "--suffix") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--suffix needs a value");
      options.suffix = value;
      index += 1;
    } else {
      throw new Error(`unknown option: ${String(arg)}`);
    }
  }
  return options;
}

function parseScenario(value: string): ScenarioName[] {
  if (value === "full") return ["full"];
  if (value === "reduced") return ["reduced"];
  if (value === "both") return ["full", "reduced"];
  throw new Error(`--scenario must be full, reduced or both (got ${value})`);
}

function parseWeekLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--weeks must be a positive integer");
  }
  return parsed;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  if (options.reportOnly) {
    const { loadResults, writeReport } = await import("./report.js");
    const results = await loadResults(OUTPUT_ROOT, options.suffix);
    const paths = await writeReport(OUTPUT_ROOT, {
      generatedAt: new Date().toISOString(),
      model: results[0]?.model ?? MODEL_ID,
      scenarios: results,
    });
    console.error(`[sim] report ${paths.pdf}`);
    return;
  }

  const apiKey =
    process.env["BENCHMARK_OPENROUTER_API_KEY"] ??
    process.env["OPENROUTER_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      "BENCHMARK_OPENROUTER_API_KEY is required; the season cannot be planned with a stub.",
    );
  }
  assertDedicatedDatabase(SIM_DATABASE_URL);
  process.env["DATABASE_URL"] = SIM_DATABASE_URL;

  const { runScenario } = await import("./engine.js");
  const { loadResults, writeReport, writeScenarioResult } =
    await import("./report.js");
  for (const scenario of options.scenarios) {
    const result = await runScenario({
      scenario,
      apiKey,
      weekLimit: options.weekLimit,
      resume: options.resume,
    });
    const path = await writeScenarioResult(OUTPUT_ROOT, result, options.suffix);
    if (options.weekLimit === undefined) {
      await clearSimulationState(OUTPUT_ROOT, scenario);
    }
    console.error(
      `[sim] ${scenario}: ${String(result.weeks.length)} weeks, ${formatCost(result.costUsd)}, ${path}`,
    );
  }
  if (options.weekLimit === undefined && options.scenarios.length === 2) {
    const results = await loadResults(OUTPUT_ROOT, options.suffix);
    const paths = await writeReport(OUTPUT_ROOT, {
      generatedAt: new Date().toISOString(),
      model: results[0]?.model ?? MODEL_ID,
      scenarios: results,
    });
    console.error(`[sim] report ${paths.pdf}`);
  }
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
