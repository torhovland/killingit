import { resolve } from "node:path";
import {
  promptBenchmarkRunDirectory,
  readPromptJson,
} from "./promptBenchmarkFiles.js";
import type {
  PromptJudgeScore,
  PromptModelResult,
} from "./promptBenchmarkTypes.js";

/** Prints a scalar field, ignoring an object where the contract wants text. */
function display(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}

/** The day object the daily-update prompt returned, when it is usable. */
function dayFromPlan(plan: unknown): Record<string, unknown> | null {
  if (typeof plan !== "object" || plan === null || !("today" in plan)) {
    return null;
  }
  const today = (plan as { today?: unknown }).today;
  return typeof today === "object" && today !== null
    ? (today as Record<string, unknown>)
    : null;
}

/**
 * Prints the top judged models with their today title, status and judgment, so
 * a human can review a run without opening the HTML report.
 */
export async function runPromptBenchmarkShortlistStage(): Promise<void> {
  const runDirectory = promptBenchmarkRunDirectory();
  const limit = Number(process.env.LIMIT ?? 30);
  const results = await readPromptJson<PromptModelResult[]>(
    resolve(runDirectory, "results.json"),
  );
  const scores = await readPromptJson<PromptJudgeScore[]>(
    resolve(runDirectory, "judge-scores.json"),
  );
  const byId = new Map(results.map((result) => [result.id, result]));
  const ranked = [...scores].sort((a, b) => b.score - a.score);

  for (const score of ranked.slice(0, limit)) {
    const result = byId.get(score.id);
    const today = dayFromPlan(result?.prompts.today.plan);
    console.log(
      `\n=== ${score.score.toFixed(1)} ${score.id} | ${((result?.totalTimeMs ?? 0) / 1000).toFixed(1)}s $${(result?.totalCostUsd ?? 0).toFixed(4)} | ${JSON.stringify(score.components)} | gates ${score.gates?.failures.length ?? 0}`,
    );
    console.log(`NOTE: ${score.note}`);
    if (today) {
      console.log(`TITLE: ${display(today.title)}`);
      console.log(
        `STATUS: ${display(today.status)} | ${display(today.type)} | ${display(today.intensity)} | ${display(today.durationMinutes)} min | TSS ${display(today.estimatedTss)} | FTP ${display(today.estimatedFtpWatts)} | optional ${display(today.optional)}`,
      );
      console.log(`DESC: ${display(today.description)}`);
      console.log(`RATIONALE: ${display(today.optionalRationale)}`);
    }
    if (score.gates && score.gates.failures.length > 0) {
      console.log(`GATES: ${score.gates.failures.join("; ")}`);
    }
  }
}
