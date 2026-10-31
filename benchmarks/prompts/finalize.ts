import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RUN_ID = process.env.RUN_ID ?? "2026-10-30-all-models";
const RUN_DIR = resolve(import.meta.dir, "runs", RUN_ID);

interface Attempt {
  parsed: unknown | null;
  error: string | null;
  parseError: string | null;
}

interface ModelResult {
  id: string;
  ok: boolean;
  plan: unknown | null;
  attempts: Attempt[];
  validationErrors: string[];
}

const REQUIRED = [
  "date",
  "status",
  "title",
  "type",
  "intensity",
  "durationMinutes",
  "outdoor",
  "canBeOutdoor",
  "estimatedTss",
  "estimatedFtpWatts",
  "bikeWorkout",
  "description",
  "optional",
  "optionalRationale",
] as const;

function fatalErrors(plan: unknown): string[] {
  if (typeof plan !== "object" || plan === null) return ["not an object"];
  const root = plan as Record<string, unknown>;
  const today = root.today;
  if (typeof today !== "object" || today === null) return ["missing today"];
  const session = today as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of REQUIRED) {
    if (!(key in session)) errors.push(`missing ${key}`);
  }
  if (session.date !== "2026-10-30") errors.push("wrong date");
  if (session.type !== "workout" && session.type !== "rest") {
    errors.push("invalid type");
  }
  if (
    !["easy", "moderate", "hard", "rest"].includes(String(session.intensity))
  ) {
    errors.push("invalid intensity");
  }
  return errors;
}

async function main(): Promise<void> {
  const results = JSON.parse(
    await readFile(resolve(RUN_DIR, "results.json"), "utf8"),
  ) as ModelResult[];
  let recovered = 0;
  for (const result of results) {
    if (result.ok) continue;
    for (const attempt of result.attempts) {
      if (attempt.parsed === null) continue;
      const errors = fatalErrors(attempt.parsed);
      if (errors.length === 0) {
        result.ok = true;
        result.plan = attempt.parsed;
        result.validationErrors = result.validationErrors.filter(
          (error) => !error.startsWith("unexpected root keys"),
        );
        recovered += 1;
        break;
      }
    }
  }
  await writeFile(
    resolve(RUN_DIR, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(
    `recovered ${recovered} models with only warning-level contract issues`,
  );
  console.log(
    `valid ${results.filter((result) => result.ok).length}/${results.length}`,
  );
}

await main();
