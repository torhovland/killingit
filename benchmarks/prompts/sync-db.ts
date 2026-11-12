import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  copyBenchmarkToAliases,
  refreshModelCatalog,
} from "../../apps/api/src/llm/modelCatalog.js";
import { recordBenchmarkGrade } from "@killingit/benchmark/src/catalogBenchmark.js";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);

interface ModelResult {
  id: string;
  name: string;
  ok: boolean;
  expired?: boolean;
  totalTimeMs: number;
  totalCostUsd: number;
}

interface JudgeScore {
  id: string;
  score: number;
  components: Record<string, number>;
  failed: boolean;
  judge: { error: string | null };
}

async function main(): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];
  const judge = JSON.parse(
    await readFile(resolve(RUN_DIR, "judge-scores.json"), "utf8"),
  ) as JudgeScore[];
  const judgeById = new Map(judge.map((entry) => [entry.id, entry]));

  if (process.env.SKIP_REFRESH !== "1") {
    const refreshed = await refreshModelCatalog({ force: true });
    console.log(
      `catalog checked=${refreshed.checked} added=${refreshed.added} retired=${refreshed.retired} rescored=${refreshed.rescored} reassigned=${refreshed.reassigned} copied=${refreshed.copied} removed=${refreshed.removed} error=${refreshed.error ?? "none"}`,
    );
  } else {
    console.log("catalog refresh skipped");
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
      // A model that reached the speed-F limit is deliberately left ungraded
      // rather than recorded as an ability failure.
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
  console.log(
    `recorded ${graded} benchmark grades and ${timedOut} speed-limit "?" grade(s) from ${RUN_ID}; ` +
      `skipped ${skipped} unfinished model(s); copied ${copied} alias result(s)`,
  );
}

await main();
