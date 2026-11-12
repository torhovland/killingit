import type { LlmModelGrade } from "@killingit/shared";
import { eq, isNull, or } from "drizzle-orm";
import { db } from "../../../apps/api/src/db/index.js";
import { llmModels } from "../../../apps/api/src/db/schema.js";
import {
  abilityGrade,
  copyBenchmarkToAliases,
  costGrade,
  isDiscouraged,
  speedGrade,
} from "../../../apps/api/src/llm/modelCatalog.js";

/**
 * Catalog queries used by the prompt benchmark. The server only needs the
 * catalog itself; grading writes and run selection live here so the runtime
 * package carries no benchmark-only code. See docs/specs/llm-model-catalog.md.
 */

async function targetChainTouchesPending(
  targetSlug: string,
  pendingIds: Set<string>,
  seen: Set<string>,
): Promise<boolean> {
  if (seen.has(targetSlug)) return false;
  seen.add(targetSlug);
  if (pendingIds.has(targetSlug)) return true;
  const rows = await db
    .select({ aliasTargetSlug: llmModels.aliasTargetSlug })
    .from(llmModels)
    .where(eq(llmModels.id, targetSlug))
    .limit(1);
  const target = rows[0]?.aliasTargetSlug ?? null;
  if (target === null) return false;
  return targetChainTouchesPending(target, pendingIds, seen);
}

/** Current stored ability grade for every catalog model, keyed by id. */
export async function benchmarkAbilityGrades(): Promise<
  Map<string, LlmModelGrade>
> {
  const rows = await db
    .select({ id: llmModels.id, ability: llmModels.ability })
    .from(llmModels);
  return new Map(rows.map((row) => [row.id, row.ability]));
}

/** Current stored cost grade for every catalog model, keyed by id. */
export async function benchmarkCostGrades(): Promise<
  Map<string, LlmModelGrade>
> {
  const rows = await db
    .select({ id: llmModels.id, cost: llmModels.cost })
    .from(llmModels);
  return new Map(rows.map((row) => [row.id, row.cost]));
}

/** Stored benchmark time for every catalog model, keyed by id. */
export async function benchmarkModelTimes(): Promise<
  Map<string, number | null>
> {
  const rows = await db
    .select({ id: llmModels.id, benchmarkTimeMs: llmModels.benchmarkTimeMs })
    .from(llmModels);
  return new Map(rows.map((row) => [row.id, row.benchmarkTimeMs]));
}

/**
 * Models the benchmark must call directly. Aliases whose target is also
 * pending are deliberately left out: grade the concrete target first, then
 * copy its result onto the alias.
 */
export async function pendingBenchmarkModelIds(): Promise<string[]> {
  // Copy any alias whose target is already graded before deciding what to run.
  await copyBenchmarkToAliases();
  const rows = await db
    .select({ id: llmModels.id, aliasTargetSlug: llmModels.aliasTargetSlug })
    .from(llmModels)
    .where(
      or(
        eq(llmModels.ability, "?"),
        eq(llmModels.speed, "?"),
        eq(llmModels.cost, "?"),
        eq(llmModels.needsRescore, true),
        isNull(llmModels.benchmarkScore),
      ),
    );
  const pendingIds = new Set(rows.map((row) => row.id));
  const result: string[] = [];
  for (const row of rows) {
    if (
      row.aliasTargetSlug !== null &&
      (await targetChainTouchesPending(
        row.aliasTargetSlug,
        pendingIds,
        new Set([row.id]),
      ))
    ) {
      continue;
    }
    result.push(row.id);
  }
  return result;
}

export interface BenchmarkGradeInput {
  id: string;
  name: string;
  score: number | null;
  timeMs: number | null;
  costUsd: number | null;
  categories: Record<string, number> | null;
  failed: boolean;
  /** Overrides the computed ability, for example "?" after a speed-limit stop. */
  ability?: LlmModelGrade;
}

/** Saves one benchmark result and recomputes its derived grades. */
export async function recordBenchmarkGrade(
  input: BenchmarkGradeInput,
): Promise<void> {
  const ability =
    input.ability ??
    abilityGrade({
      score: input.score,
      categories: input.categories,
      failed: input.failed,
    });
  const speed = speedGrade(input.timeMs);
  const cost = costGrade(input.costUsd);
  const discouraged = isDiscouraged(ability, speed, cost);
  await db
    .insert(llmModels)
    .values({
      id: input.id,
      name: input.name,
      ability,
      speed,
      cost,
      discouraged,
      benchmarkScore: input.score,
      benchmarkTimeMs: input.timeMs === null ? null : Math.round(input.timeMs),
      benchmarkCostUsd: input.costUsd,
      benchmarkCategories: input.categories,
      benchmarkedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: llmModels.id,
      set: {
        name: input.name,
        ability,
        speed,
        cost,
        discouraged,
        benchmarkScore: input.score,
        benchmarkTimeMs:
          input.timeMs === null ? null : Math.round(input.timeMs),
        benchmarkCostUsd: input.costUsd,
        benchmarkCategories: input.categories,
        benchmarkedAt: new Date(),
        lastSeenAt: new Date(),
        needsRescore: false,
        updatedAt: new Date(),
      },
    });
}
