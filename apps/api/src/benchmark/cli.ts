import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { PLAN_MAX_TOKENS } from "../llm/planBudget.js";
import { BENCHMARK_HELP, parseBenchmarkArgs } from "./config.js";
import { loadBenchmarkFixture } from "./fixtures.js";
import { renderBenchmarkReport } from "./report.js";
import { createBenchmarkRunner } from "./run.js";
import type {
  BenchmarkMetadata,
  BenchmarkResults,
  BenchmarkScores,
} from "./types.js";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const scoresSchema = z.record(
  z.string(),
  z.object({
    quality: z.number().min(0).max(10),
    notes: z.string(),
  }),
);

function slug(model: string): string {
  return model.replace(/[^a-zA-Z0-9.-]+/g, "_");
}

function gitCommit(): string | null {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}

async function readScores(
  path: string | null,
): Promise<BenchmarkScores | null> {
  if (path === null) return null;
  const raw = await readFile(path, "utf8");
  return scoresSchema.parse(JSON.parse(raw));
}

async function writeScores(
  directory: string,
  scores: BenchmarkScores | null,
): Promise<void> {
  if (scores === null) return;
  await writeFile(
    resolve(directory, "scores.json"),
    `${JSON.stringify(scores, null, 2)}\n`,
  );
}

function log(message: string): void {
  console.log(`benchmark> ${message}`);
}

async function reportOnly(
  directory: string,
  scoresPath: string | null,
): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(directory, "results.json"), "utf8"),
  ) as BenchmarkResults;
  const defaultScores = resolve(directory, "scores.json");
  const scores = await readScores(
    scoresPath ??
      ((await Bun.file(defaultScores).exists()) ? defaultScores : null),
  );
  await writeScores(directory, scores);
  await writeFile(
    resolve(directory, "report.md"),
    `${renderBenchmarkReport(results, { scores })}\n`,
  );
  log(`wrote ${resolve(directory, "report.md")}`);
}

async function main(): Promise<void> {
  const config = await parseBenchmarkArgs(process.argv.slice(2));
  if (config.help) {
    console.log(BENCHMARK_HELP);
    return;
  }
  if (config.reportOnlyDir !== null) {
    await reportOnly(config.reportOnlyDir, config.scoresPath);
    return;
  }

  const directory = resolve(config.outputRoot, config.runId);
  const resultsPath = resolve(directory, "results.json");
  if (await Bun.file(resultsPath).exists()) {
    throw new Error(
      `Run directory already has results: ${directory}. Pass a new --run-id.`,
    );
  }

  const scores = await readScores(config.scoresPath);
  const fixture = await loadBenchmarkFixture({
    userId: config.userId,
    today: config.today,
    refreshToday: config.refreshToday,
  });
  log(
    `user ${fixture.userId}: ${fixture.answers.length} answers, ` +
      `${fixture.activities.length} activities, ` +
      `${fixture.fullInputs.activityComments.length} comments, ` +
      `${fixture.fullInputs.periodReviews.length} reviews`,
  );
  if (fixture.activities.length === 0) {
    log(
      "warning: no cached activities; the plan will be built from the profile alone",
    );
  }

  await mkdir(resolve(directory, "plans"), { recursive: true });
  const metadata: BenchmarkMetadata = {
    runId: config.runId,
    runAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    userId: fixture.userId,
    today: config.today,
    refreshToday: config.refreshToday,
    benchmarkModel: config.models[0] ?? "",
    models: config.models,
    planMaxTokens: PLAN_MAX_TOKENS,
    exclusions: [
      "Weather and daylight are not loaded; the benchmark does not depend on a saved location.",
      "The completed-week summary and post-build activity-review calls are excluded; they do not change the four plan levels.",
      "Plans are generated in memory and are never written to the athlete's stored plan.",
    ],
  };

  const runner = await createBenchmarkRunner({
    apiKey: fixture.apiKey,
    fixture,
    today: config.today,
    refreshToday: config.refreshToday,
    models: config.models,
  });

  const results: BenchmarkResults = { metadata, models: {} };
  const writeResults = async () => {
    await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  };
  await writeFile(
    resolve(directory, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  for (const model of config.models) {
    log(`${model}: full build`);
    const result = await runner.runModel(model);
    const full = result.full;
    const refresh = result.refresh;
    log(
      `${model}: full ${full ? `${full.ok ? "ok" : "FAILED"} ${(full.wallMs / 1000).toFixed(1)}s $${full.costUsd.toFixed(4)}` : "missing"}`,
    );
    if (refresh) {
      log(
        `${model}: refresh ${refresh.ok ? "ok" : "FAILED"} ${(refresh.wallMs / 1000).toFixed(1)}s $${refresh.costUsd.toFixed(4)}`,
      );
    }
    results.models[model] = result;
    await writeResults();
    await writeFile(
      resolve(directory, "plans", `${slug(model)}.json`),
      `${JSON.stringify({ full: result.full?.plan ?? null, refresh: result.refresh?.plan ?? null }, null, 2)}\n`,
    );
  }

  await writeScores(directory, scores);
  await writeFile(
    resolve(directory, "report.md"),
    `${renderBenchmarkReport(results, { scores })}\n`,
  );
  log(`wrote ${directory}`);
}

await main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
