import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-31-two-prompts";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);
const LIMIT = Number(process.env.LIMIT ?? 30);

interface PromptResult {
  ok: boolean;
  plan: { today?: Record<string, unknown> } | null;
}

interface ModelResult {
  id: string;
  totalTimeMs: number;
  totalCostUsd: number;
  prompts: {
    today: PromptResult;
    reviseSeason: PromptResult;
  };
}

interface Score {
  id: string;
  score: number;
  note: string;
  components: Record<string, number>;
  failed: boolean;
  gates: { failures: string[] } | null;
}

const results = JSON.parse(
  await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
) as ModelResult[];
const scores = JSON.parse(
  await readFile(resolve(RUN_DIR, "judge-scores.json"), "utf8"),
) as Score[];
const byId = new Map(results.map((result) => [result.id, result]));
const ranked = [...scores].sort((a, b) => b.score - a.score);

for (const score of ranked.slice(0, LIMIT)) {
  const result = byId.get(score.id);
  const today = result?.prompts.today.plan?.today;
  console.log(
    `\n=== ${score.score.toFixed(1)} ${score.id} | ${((result?.totalTimeMs ?? 0) / 1000).toFixed(1)}s $${(result?.totalCostUsd ?? 0).toFixed(4)} | ${JSON.stringify(score.components)} | gates ${score.gates?.failures.length ?? 0}`,
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
  if (score.gates && score.gates.failures.length > 0) {
    console.log(`GATES: ${score.gates.failures.join("; ")}`);
  }
}
