import { resolve } from "node:path";
import {
  copyBenchmarkToAliases,
  refreshModelCatalog,
} from "../../../apps/api/src/llm/modelCatalog.js";
import { recordBenchmarkGrade } from "./catalogBenchmark.js";
import {
  logPromptBenchmark,
  promptBenchmarkRunDirectory,
  promptBenchmarkRunId,
  readPromptJson,
  readPromptJsonOr,
} from "./promptBenchmarkFiles.js";
import type {
  PromptJudgeScore,
  PromptModelResult,
} from "./promptBenchmarkTypes.js";

/**
 * Refreshes the catalog and records the run's grades. A model stopped at the
 * speed-F limit is written with ability `?`, never F, and `SKIP_FAILED` leaves
 * infrastructure failures at their previous grade instead of failing a model.
 */
export async function runPromptBenchmarkSyncStage(): Promise<void> {
  const runDirectory = promptBenchmarkRunDirectory();
  const results = await readPromptJson<PromptModelResult[]>(
    resolve(runDirectory, "results.json"),
  );
  const judge = await readPromptJsonOr<PromptJudgeScore[]>(
    resolve(runDirectory, "judge-scores.json"),
    [],
  );
  const judgeById = new Map(judge.map((entry) => [entry.id, entry]));

  if (process.env.SKIP_REFRESH !== "1") {
    const refreshed = await refreshModelCatalog({ force: true });
    logPromptBenchmark(
      `catalog checked=${refreshed.checked} added=${refreshed.added} retired=${refreshed.retired} rescored=${refreshed.rescored} reassigned=${refreshed.reassigned} copied=${refreshed.copied} removed=${refreshed.removed} error=${refreshed.error ?? "none"}`,
    );
  } else {
    logPromptBenchmark("catalog refresh skipped");
  }

  const skipFailed = process.env.SKIP_FAILED === "1";
  let graded = 0;
  let skipped = 0;
  let timedOut = 0;
  for (const result of results) {
    if (result.expired === true) {
      if (skipFailed) {
        skipped += 1;
        continue;
      }
      await recordBenchmarkGrade({
        id: result.id,
        name: result.name,
        score: null,
        timeMs: result.totalTimeMs,
        costUsd: null,
        categories: null,
        failed: false,
        ability: "?",
      });
      timedOut += 1;
      continue;
    }
    const judged = judgeById.get(result.id);
    const invalid =
      !result.ok || judged === undefined || judged.judge.error !== null;
    if (invalid && skipFailed) {
      skipped += 1;
      continue;
    }
    const failed = invalid || judged.failed;
    await recordBenchmarkGrade({
      id: result.id,
      name: result.name,
      score: invalid ? 0 : judged.score,
      timeMs: result.totalTimeMs,
      costUsd: result.totalCostUsd,
      categories: invalid ? null : judged.components,
      failed,
    });
    graded += 1;
  }
  const copied = await copyBenchmarkToAliases({ force: true });
  logPromptBenchmark(
    `recorded ${graded} benchmark grades and ${timedOut} speed-limit "?" grade(s) from ${promptBenchmarkRunId()}; ` +
      `skipped ${skipped} unfinished model(s); copied ${copied} alias result(s)`,
  );
}
