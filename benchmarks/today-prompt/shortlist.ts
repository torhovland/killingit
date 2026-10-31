import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-30-all-models";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const LIMIT = Number(process.env.LIMIT ?? 30);

interface ModelResult {
  id: string;
  totalTimeMs: number;
  totalCostUsd: number;
  retryNeeded: boolean;
  plan: { today?: Record<string, unknown> } | null;
}

interface Score {
  id: string;
  score: number;
  note: string;
  components: Record<string, number>;
}

const results = JSON.parse(
  await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
) as ModelResult[];
const scores = JSON.parse(
  await readFile(resolve(RUN_DIR, "scores.json"), "utf8"),
) as Score[];
const byId = new Map(results.map((result) => [result.id, result]));
const ranked = [...scores].sort((a, b) => b.score - a.score);

for (const score of ranked.slice(0, LIMIT)) {
  const result = byId.get(score.id);
  const today = result?.plan?.today;
  console.log(
    `\n=== ${score.score.toFixed(1)} ${score.id} | ${((result?.totalTimeMs ?? 0) / 1000).toFixed(1)}s $${(result?.totalCostUsd ?? 0).toFixed(4)} | retry ${result?.retryNeeded ? "yes" : "no"} | ${JSON.stringify(score.components)}`,
  );
  console.log(`NOTE: ${score.note}`);
  if (today) {
    console.log(`TITLE: ${today.title}`);
    console.log(
      `STATUS: ${today.status} | ${today.type} | ${today.intensity} | ${today.durationMinutes} min | TSS ${today.estimatedTss} | FTP ${today.estimatedFtpWatts} | optional ${today.optional}`,
    );
    console.log(`DESC: ${today.description}`);
    console.log(`RATIONALE: ${today.optionalRationale}`);
  }
}
