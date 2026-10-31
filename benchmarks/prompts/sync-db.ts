import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  copyBenchmarkToAliases,
  recordBenchmarkGrade,
  refreshModelCatalog,
} from "../../apps/api/src/llm/modelCatalog.js";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);

interface ModelResult {
  id: string;
  name: string;
  ok: boolean;
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

  const refreshed = await refreshModelCatalog({ force: true });
  console.log(
    `catalog checked=${refreshed.checked} added=${refreshed.added} retired=${refreshed.retired} rescored=${refreshed.rescored} reassigned=${refreshed.reassigned} copied=${refreshed.copied} error=${refreshed.error ?? "none"}`,
  );

  let graded = 0;
  for (const result of results) {
    const judged = judgeById.get(result.id);
    const invalid =
      !result.ok || judged === undefined || judged.judge.error !== null;
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
  const copied = await copyBenchmarkToAliases();
  console.log(
    `recorded ${graded} benchmark grades from ${RUN_ID}; copied ${copied} alias result(s)`,
  );
}

await main();
