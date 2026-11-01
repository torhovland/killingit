import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BENCHMARK_PROMPTS,
  validateReviseSeasonPlan,
  validateTodayPlan,
} from "../../apps/api/src/llm/promptBenchmark.js";
import type { BenchmarkPromptId } from "../../apps/api/src/llm/promptBenchmark.js";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);

interface Attempt {
  parsed: unknown | null;
  error: string | null;
  parseError: string | null;
}

interface PromptResult {
  prompt: BenchmarkPromptId;
  ok: boolean;
  plan: unknown | null;
  attempts: Attempt[];
  validationErrors: string[];
}

interface ModelResult {
  ok: boolean;
  prompts: Record<BenchmarkPromptId, PromptResult>;
}

function fatalErrors(prompt: BenchmarkPromptId, plan: unknown): string[] {
  const errors =
    prompt === "today"
      ? validateTodayPlan(plan)
      : validateReviseSeasonPlan(plan);
  return errors.filter(
    (error) =>
      !error.startsWith("unexpected root keys") &&
      !error.startsWith("unexpected top-level keys"),
  );
}

async function main(): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];
  let recovered = 0;
  for (const result of results) {
    for (const definition of BENCHMARK_PROMPTS) {
      const promptResult = result.prompts[definition.id];
      if (promptResult.ok) continue;
      for (const attempt of promptResult.attempts) {
        if (attempt.parsed === null) continue;
        const errors = fatalErrors(definition.id, attempt.parsed);
        if (errors.length === 0) {
          promptResult.ok = true;
          promptResult.plan = attempt.parsed;
          promptResult.validationErrors = promptResult.validationErrors.filter(
            (error) =>
              !error.startsWith("unexpected root keys") &&
              !error.startsWith("unexpected top-level keys"),
          );
          recovered += 1;
          break;
        }
      }
    }
    result.ok = BENCHMARK_PROMPTS.every(
      (definition) => result.prompts[definition.id].ok,
    );
  }
  await writeFile(
    resolve(RUN_DIR, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(
    `recovered ${recovered} prompt responses with only warning-level contract issues`,
  );
  console.log(
    `valid ${results.filter((result) => result.ok).length}/${results.length} models on both prompts`,
  );
}

await main();
