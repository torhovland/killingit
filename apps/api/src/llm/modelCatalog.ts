import type { LlmModel, LlmModelGrade } from "@killingit/shared";
import { and, eq, isNull, lt, notInArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmModels, llmModelSync } from "../db/schema.js";
import { createOpenRouterProvider } from "./openrouter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Category maxima used by the Haiku judge. A category below half is an F. */
export const BENCHMARK_CATEGORY_MAXIMA = {
  contract: 1.5,
  fidelity: 2,
  design: 3,
  rationale: 2,
  grounding: 2,
  detail: 2,
} as const;

/**
 * Cost bands for the middle grades. The B/C/D cuts sit at the 25th, 50th and
 * 75th percentiles of the measured benchmark costs between $0.05 and $0.30,
 * which keeps those three bands roughly equally populated.
 */
export const COST_GRADE_LIMITS = {
  aPlus: 0.01,
  a: 0.05,
  b: 0.061,
  c: 0.077,
  d: 0.131,
  e: 0.3,
} as const;

export const GRADE_ORDER: Record<LlmModelGrade, number> = {
  "A+": 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
  F: 0,
  "?": -1,
};

/** Estimated benchmark cost for a model that has not been called yet. */
export function estimateBenchmarkCost(
  promptPricePerMillion: number | null,
  completionPricePerMillion: number | null,
): number | null {
  if (promptPricePerMillion === null && completionPricePerMillion === null) {
    return null;
  }
  return (
    ((promptPricePerMillion ?? 0) * 16_000) / 1_000_000 +
    ((completionPricePerMillion ?? 0) * 1_200) / 1_000_000
  );
}

export function costGrade(costUsd: number | null | undefined): LlmModelGrade {
  if (costUsd === null || costUsd === undefined) return "?";
  if (costUsd < COST_GRADE_LIMITS.aPlus) return "A+";
  if (costUsd < COST_GRADE_LIMITS.a) return "A";
  if (costUsd < COST_GRADE_LIMITS.b) return "B";
  if (costUsd < COST_GRADE_LIMITS.c) return "C";
  if (costUsd < COST_GRADE_LIMITS.d) return "D";
  if (costUsd < COST_GRADE_LIMITS.e) return "E";
  return "F";
}

export function speedGrade(timeMs: number | null | undefined): LlmModelGrade {
  if (timeMs === null || timeMs === undefined) return "?";
  if (timeMs < 10_000) return "A+";
  if (timeMs < 20_000) return "A";
  if (timeMs < 30_000) return "B";
  if (timeMs < 45_000) return "C";
  if (timeMs < 90_000) return "D";
  if (timeMs < 150_000) return "E";
  return "F";
}

export interface AbilityInput {
  score: number | null | undefined;
  categories?: Record<string, number> | null;
  failed?: boolean;
}

/**
 * Ability is the benchmark score band, unless the run failed or any category
 * scored below half of its maximum. A category failure always grades F.
 *
 * Score bands: A+ >= 11.1, A >= 10.5, B >= 9.0, C >= 8.0, D >= 7.5,
 * E > 0, F otherwise.
 */
export function abilityGrade({
  score,
  categories,
  failed = false,
}: AbilityInput): LlmModelGrade {
  if (failed || score === null || score === undefined || score <= 0) return "F";
  if (categories) {
    for (const [key, maximum] of Object.entries(BENCHMARK_CATEGORY_MAXIMA)) {
      const value = categories[key];
      if (value === undefined || value < maximum / 2) return "F";
    }
  } else {
    return "F";
  }
  if (score >= 11.1) return "A+";
  if (score >= 10.5) return "A";
  if (score >= 9.0) return "B";
  if (score >= 8.0) return "C";
  if (score >= 7.5) return "D";
  return "E";
}

export function isDiscouraged(
  ability: LlmModelGrade,
  speed: LlmModelGrade,
  cost: LlmModelGrade,
): boolean {
  if (ability === "?" || speed === "?" || cost === "?") return false;
  return GRADE_ORDER[ability] < GRADE_ORDER.B || speed === "F" || cost === "F";
}

export interface CatalogRefreshResult {
  checked: boolean;
  added: number;
  retired: number;
  error: string | null;
}

async function claimCatalogCheck(): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DAY_MS);
  await db.insert(llmModelSync).values({ id: 1 }).onConflictDoNothing();
  const claimed = await db
    .update(llmModelSync)
    .set({ lastCheckedAt: now, updatedAt: now })
    .where(
      and(
        eq(llmModelSync.id, 1),
        or(
          isNull(llmModelSync.lastCheckedAt),
          lt(llmModelSync.lastCheckedAt, cutoff),
        ),
      ),
    )
    .returning({ id: llmModelSync.id });
  return claimed.length > 0;
}

async function recomputeDiscouraged(): Promise<void> {
  const rows = await db.select().from(llmModels);
  for (const row of rows) {
    const discouraged = isDiscouraged(row.ability, row.speed, row.cost);
    if (discouraged !== row.discouraged) {
      await db
        .update(llmModels)
        .set({ discouraged, updatedAt: new Date() })
        .where(eq(llmModels.id, row.id));
    }
  }
}

/**
 * Checks OpenRouter's catalog at most once every 24 hours. New models are
 * inserted ungraded (`?`) with a cost grade estimated from their list price;
 * models that disappeared are marked retired. Existing grades are never
 * overwritten by a catalog refresh.
 */
export async function refreshModelCatalog(
  options: { force?: boolean; now?: Date } = {},
): Promise<CatalogRefreshResult> {
  if (options.force !== true && !(await claimCatalogCheck())) {
    return { checked: false, added: 0, retired: 0, error: null };
  }

  try {
    const provider = createOpenRouterProvider();
    const models = await provider.listModels();
    const existing = await db
      .select({
        id: llmModels.id,
        ability: llmModels.ability,
      })
      .from(llmModels);
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const incomingIds = new Set(models.map((model) => model.id));
    let added = 0;

    for (const model of models) {
      const cost = estimateBenchmarkCost(
        model.promptPricePerMillion,
        model.completionPricePerMillion,
      );
      const prior = existingById.get(model.id);
      if (prior !== undefined) {
        await db
          .update(llmModels)
          .set({
            name: model.name,
            retired: false,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
            // An unbenchmarked model's cost estimate can follow list-price
            // changes; a graded model's measured cost is never overwritten.
            ...(prior.ability === "?"
              ? { cost: costGrade(cost), benchmarkCostUsd: cost }
              : {}),
          })
          .where(eq(llmModels.id, model.id));
      } else {
        added += 1;
        await db.insert(llmModels).values({
          id: model.id,
          name: model.name,
          retired: false,
          discouraged: false,
          ability: "?",
          speed: "?",
          cost: costGrade(cost),
          benchmarkCostUsd: cost,
          lastSeenAt: new Date(),
        });
      }
    }

    let retired = 0;
    if (incomingIds.size > 0) {
      const retiredRows = await db
        .update(llmModels)
        .set({ retired: true, updatedAt: new Date() })
        .where(
          and(
            eq(llmModels.retired, false),
            notInArray(llmModels.id, [...incomingIds]),
          ),
        )
        .returning({ id: llmModels.id });
      retired = retiredRows.length;
    }

    await recomputeDiscouraged();
    await db
      .update(llmModelSync)
      .set({ lastError: null, updatedAt: new Date() })
      .where(eq(llmModelSync.id, 1));
    return { checked: true, added, retired, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(llmModelSync)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(llmModelSync.id, 1));
    return { checked: true, added: 0, retired: 0, error: message };
  }
}

let inFlight: Promise<CatalogRefreshResult> | null = null;

/** Fire-and-forget entry point used on a page visit. */
export function ensureModelCatalogFresh(): Promise<CatalogRefreshResult> {
  if (inFlight !== null) return inFlight;
  inFlight = refreshModelCatalog().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export interface CatalogRow {
  id: string;
  name: string;
  retired: boolean;
  discouraged: boolean;
  ability: LlmModelGrade;
  speed: LlmModelGrade;
  cost: LlmModelGrade;
  benchmarkScore: number | null;
  benchmarkTimeMs: number | null;
  benchmarkCostUsd: number | null;
}

export async function loadModelCatalog(): Promise<CatalogRow[]> {
  const rows = await db.select().from(llmModels);
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      retired: row.retired,
      discouraged: row.discouraged,
      ability: row.ability,
      speed: row.speed,
      cost: row.cost,
      benchmarkScore: row.benchmarkScore,
      benchmarkTimeMs: row.benchmarkTimeMs,
      benchmarkCostUsd: row.benchmarkCostUsd,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function modelIsUsable(modelId: string): Promise<{
  usable: boolean;
  retired: boolean;
  discouraged: boolean;
} | null> {
  const rows = await db
    .select({
      retired: llmModels.retired,
      discouraged: llmModels.discouraged,
    })
    .from(llmModels)
    .where(eq(llmModels.id, modelId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    usable: !row.retired && !row.discouraged,
    retired: row.retired,
    discouraged: row.discouraged,
  };
}

export async function pendingBenchmarkModelIds(): Promise<string[]> {
  const rows = await db
    .select({ id: llmModels.id })
    .from(llmModels)
    .where(
      or(
        eq(llmModels.ability, "?"),
        eq(llmModels.speed, "?"),
        eq(llmModels.cost, "?"),
        isNull(llmModels.benchmarkScore),
      ),
    );
  return rows.map((row) => row.id);
}

export interface BenchmarkGradeInput {
  id: string;
  name: string;
  score: number | null;
  timeMs: number | null;
  costUsd: number | null;
  categories: Record<string, number> | null;
  failed: boolean;
}

/** Saves one benchmark result and recomputes its derived grades. */
export async function recordBenchmarkGrade(
  input: BenchmarkGradeInput,
): Promise<void> {
  const ability = abilityGrade({
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
        updatedAt: new Date(),
      },
    });
}

/** Models the benchmark still needs to grade. */
export async function benchmarkModelsToRun(
  allModels: readonly LlmModel[],
): Promise<LlmModel[]> {
  const pending = new Set(await pendingBenchmarkModelIds());
  if (pending.size === 0) return [];
  return allModels.filter((model) => pending.has(model.id));
}
