import { resolve } from "node:path";
import {
  logPromptBenchmark,
  promptBenchmarkRunDirectory,
  readPromptJson,
  writePromptJson,
} from "./promptBenchmarkFiles.js";
import { BENCHMARK_PROMPTS } from "./promptBenchmarkInput.js";
import {
  fatalPromptErrors,
  isWarningOnlyPromptError,
} from "./promptBenchmark.js";
import type { PromptModelResult } from "./promptBenchmarkTypes.js";

/**
 * Recovers responses that were rejected only for a warning-level contract
 * issue, such as an unexpected extra top-level key. A response with a real
 * contract error is left invalid.
 */
export async function runPromptBenchmarkFinalizeStage(): Promise<void> {
  const runDirectory = promptBenchmarkRunDirectory();
  const resultsPath = resolve(runDirectory, "results.json");
  const results = await readPromptJson<PromptModelResult[]>(resultsPath);
  let recovered = 0;
  for (const result of results) {
    for (const definition of BENCHMARK_PROMPTS) {
      const promptResult = result.prompts[definition.id];
      if (promptResult.ok) continue;
      for (const attempt of promptResult.attempts) {
        if (attempt.parsed === null) continue;
        const errors = fatalPromptErrors(definition.id, attempt.parsed);
        if (errors.length === 0) {
          promptResult.ok = true;
          promptResult.plan = attempt.parsed;
          promptResult.validationErrors = promptResult.validationErrors.filter(
            (error) => !isWarningOnlyPromptError(error),
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
  await writePromptJson(resultsPath, results);
  logPromptBenchmark(
    `recovered ${recovered} prompt responses with only warning-level contract issues`,
  );
  logPromptBenchmark(
    `valid ${results.filter((result) => result.ok).length}/${results.length} models on both prompts`,
  );
}
