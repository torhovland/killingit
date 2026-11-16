import type { LlmModel, LlmModelGrade } from "@killingit/shared";
import {
  and,
  eq,
  isNotNull,
  isNull,
  like,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import { db } from "../db/index.js";
import { llmModels, llmModelSync } from "../db/schema.js";
import { errorMessage } from "../lib/errorMessage.js";
import { estimateBenchmarkCost, priceGrade } from "./modelCatalogPricing.js";
import { catalogUpdateFor } from "./modelCatalogUpdate.js";
import { createOpenRouterProvider } from "./openrouter.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Category maxima used by the Haiku judge. A category below half is an F. */
const BENCHMARK_CATEGORY_MAXIMA = {
  contract: 1.5,
  fidelity: 2,
  design: 3,
  rationale: 2,
  grounding: 2,
  detail: 2,
} as const;

/**
 * Cost bands for the two-prompt benchmark. The cuts are calibrated so the
 * measured cost grades roughly match the list-price grades: about 58% exact
 * and 88% within one grade on the latest run, with the same overall shape.
 */
const COST_GRADE_LIMITS = {
  aPlus: 0.015,
  a: 0.04,
  b: 0.1,
  c: 0.15,
  d: 0.35,
  e: 2.5,
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

/** At or above this total time the speed grade is F. */
export const SPEED_F_LIMIT_MS = 1_200_000;

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

/** Speed is the sum of both benchmark prompts, including retries. */
export function speedGrade(timeMs: number | null | undefined): LlmModelGrade {
  if (timeMs === null || timeMs === undefined) return "?";
  if (timeMs < 45_000) return "A+";
  if (timeMs < 90_000) return "A";
  if (timeMs < 180_000) return "B";
  if (timeMs < 300_000) return "C";
  if (timeMs < 600_000) return "D";
  if (timeMs < SPEED_F_LIMIT_MS) return "E";
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
 * Score bands: A+ >= 11.1, A >= 10.5, B >= 10.2, C >= 9.8, D >= 9.6,
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
  if (score >= 10.2) return "B";
  if (score >= 9.8) return "C";
  if (score >= 9.6) return "D";
  return "E";
}

export function isDiscouraged(
  ability: LlmModelGrade,
  speed: LlmModelGrade,
  cost: LlmModelGrade,
): boolean {
  // Any known disqualifying grade is enough. An ungraded (`?`) category is
  // ignored rather than making the whole model safe.
  const abilityDisqualified =
    ability !== "?" && GRADE_ORDER[ability] < GRADE_ORDER.B;
  return abilityDisqualified || speed === "F" || cost === "F";
}

export interface CatalogRefreshResult {
  checked: boolean;
  added: number;
  retired: number;
  /** Models whose list price changed and whose cost grade was refreshed. */
  rescored: number;
  /** Alias models whose concrete target changed and now await a new score. */
  reassigned: number;
  /** Alias models that inherited their target's benchmark data. */
  copied: number;
  /** Batch-only catalog rows removed from the table. */
  removed: number;
  error: string | null;
}

/** The counters a catalog refresh accumulates before it finalises. */
interface CatalogRefreshCounts {
  added: number;
  retired: number;
  rescored: number;
  reassigned: number;
  copied: number;
  removed: number;
}

const NO_CATALOG_CHANGES: CatalogRefreshCounts = {
  added: 0,
  retired: 0,
  rescored: 0,
  reassigned: 0,
  copied: 0,
  removed: 0,
};

/**
 * One shape for a skipped, failed or completed refresh. A skipped or failed
 * refresh changed nothing, so it reports zeros; only the completed step names
 * its counters and clears the error.
 */
function catalogRefreshResult(
  checked: boolean,
  counts: CatalogRefreshCounts = NO_CATALOG_CHANGES,
  error: string | null = null,
): CatalogRefreshResult {
  return { checked, ...counts, error };
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

interface BenchmarkCopy {
  ability: LlmModelGrade;
  speed: LlmModelGrade;
  cost: LlmModelGrade;
  benchmarkScore: number | null;
  benchmarkTimeMs: number | null;
  benchmarkCategories: Record<string, number> | null;
  benchmarkedAt: Date | null;
  benchmarkCostUsd: number | null;
}

/** Follows alias targets until it finds a graded model, if one exists. */
async function loadTargetBenchmark(
  targetSlug: string,
  seen: Set<string> = new Set(),
): Promise<BenchmarkCopy | null> {
  if (seen.has(targetSlug)) return null;
  seen.add(targetSlug);
  const rows = await db
    .select({
      ability: llmModels.ability,
      speed: llmModels.speed,
      cost: llmModels.cost,
      benchmarkScore: llmModels.benchmarkScore,
      benchmarkTimeMs: llmModels.benchmarkTimeMs,
      benchmarkCategories: llmModels.benchmarkCategories,
      benchmarkedAt: llmModels.benchmarkedAt,
      benchmarkCostUsd: llmModels.benchmarkCostUsd,
      needsRescore: llmModels.needsRescore,
      aliasTargetSlug: llmModels.aliasTargetSlug,
    })
    .from(llmModels)
    .where(eq(llmModels.id, targetSlug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.ability !== "?" && row.benchmarkScore !== null && !row.needsRescore) {
    return {
      ability: row.ability,
      speed: row.speed,
      cost: row.cost,
      benchmarkScore: row.benchmarkScore,
      benchmarkTimeMs: row.benchmarkTimeMs,
      benchmarkCategories: row.benchmarkCategories,
      benchmarkedAt: row.benchmarkedAt,
      benchmarkCostUsd: row.benchmarkCostUsd,
    };
  }
  if (row.aliasTargetSlug !== null) {
    return loadTargetBenchmark(row.aliasTargetSlug, seen);
  }
  return null;
}

/**
 * Copies the concrete model's benchmark data, including its measured cost,
 * onto an alias. With `force`, every alias with a graded target is refreshed,
 * so an alias that was benchmarked directly always ends up matching its
 * target. The alias keeps its own list prices for the price grade.
 */
export async function copyBenchmarkToAliases(
  options: { force?: boolean } = {},
): Promise<number> {
  const aliases = await db
    .select()
    .from(llmModels)
    .where(
      options.force === true
        ? isNotNull(llmModels.aliasTargetSlug)
        : and(
            isNotNull(llmModels.aliasTargetSlug),
            or(eq(llmModels.ability, "?"), eq(llmModels.needsRescore, true)),
          ),
    );
  let copied = 0;
  for (const alias of aliases) {
    if (alias.aliasTargetSlug === null) continue;
    const target = await loadTargetBenchmark(alias.aliasTargetSlug);
    if (target === null) continue;
    await db
      .update(llmModels)
      .set({
        ability: target.ability,
        speed: target.speed,
        benchmarkScore: target.benchmarkScore,
        benchmarkTimeMs: target.benchmarkTimeMs,
        benchmarkCategories: target.benchmarkCategories,
        benchmarkedAt: target.benchmarkedAt,
        benchmarkCostUsd: target.benchmarkCostUsd,
        cost: target.cost,
        needsRescore: false,
        updatedAt: new Date(),
      })
      .where(eq(llmModels.id, alias.id));
    copied += 1;
  }
  return copied;
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

/** Fetches OpenRouter's model list, the only network step of a refresh. */
async function fetchCatalogModels(): Promise<LlmModel[]> {
  const provider = createOpenRouterProvider();
  return provider.listModels();
}

/**
 * Reconciles the stored catalog with the provider's list: deletes batch-only
 * rows, inserts new models ungraded with a price grade, refreshes existing
 * models, and retires the models that disappeared. Existing benchmark grades
 * are never overwritten, except on an alias whose concrete target moved. Every
 * row written by one refresh shares the same timestamp.
 */
async function storeCatalogModels(
  models: readonly LlmModel[],
): Promise<Omit<CatalogRefreshCounts, "copied">> {
  const now = new Date();
  const removedRows = await db
    .delete(llmModels)
    .where(like(llmModels.id, "%:batch"))
    .returning({ id: llmModels.id });
  const removed = removedRows.length;
  const existing = await db
    .select({
      id: llmModels.id,
      ability: llmModels.ability,
      aliasTargetSlug: llmModels.aliasTargetSlug,
      promptPricePerMillion: llmModels.promptPricePerMillion,
      completionPricePerMillion: llmModels.completionPricePerMillion,
    })
    .from(llmModels);
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const incomingIds = new Set(models.map((model) => model.id));
  let added = 0;
  let rescored = 0;
  let reassigned = 0;

  for (const model of models) {
    const change = catalogUpdateFor(
      existingById.get(model.id) ?? null,
      model,
      priceGrade(model.promptPricePerMillion, model.completionPricePerMillion),
      estimateBenchmarkCost(
        model.promptPricePerMillion,
        model.completionPricePerMillion,
      ),
    );
    if (change.action === "insert") {
      added += 1;
      await db.insert(llmModels).values({ ...change.values, lastSeenAt: now });
      continue;
    }
    if (change.rescored) rescored += 1;
    if (change.reassigned) reassigned += 1;
    await db
      .update(llmModels)
      .set({ ...change.values, lastSeenAt: now, updatedAt: now })
      .where(eq(llmModels.id, model.id));
  }

  let retired = 0;
  if (incomingIds.size > 0) {
    const retiredRows = await db
      .update(llmModels)
      .set({ retired: true, updatedAt: now })
      .where(
        and(
          eq(llmModels.retired, false),
          notInArray(llmModels.id, [...incomingIds]),
        ),
      )
      .returning({ id: llmModels.id });
    retired = retiredRows.length;
  }

  return { added, retired, rescored, reassigned, removed };
}

/**
 * Completes a stored refresh: copies graded benchmark data onto aliases,
 * recomputes discouraged, clears the sync error and returns the counters.
 */
async function finaliseCatalogRefresh(
  counts: Omit<CatalogRefreshCounts, "copied">,
): Promise<CatalogRefreshResult> {
  const copied = await copyBenchmarkToAliases();
  await recomputeDiscouraged();
  await db
    .update(llmModelSync)
    .set({ lastError: null, updatedAt: new Date() })
    .where(eq(llmModelSync.id, 1));
  return catalogRefreshResult(true, { ...counts, copied });
}

/** Records a failed refresh's message on the sync row and returns it. */
async function failCatalogRefresh(err: unknown): Promise<CatalogRefreshResult> {
  const message = errorMessage(err);
  await db
    .update(llmModelSync)
    .set({ lastError: message, updatedAt: new Date() })
    .where(eq(llmModelSync.id, 1));
  return catalogRefreshResult(true, NO_CATALOG_CHANGES, message);
}

/**
 * Checks OpenRouter's catalog at most once every 24 hours. New models are
 * inserted ungraded (`?`) with a cost grade estimated from their list price;
 * models that disappeared are marked retired. Existing grades are never
 * overwritten by a catalog refresh, except on an alias whose concrete target
 * moved.
 */
export async function refreshModelCatalog(
  options: { force?: boolean } = {},
): Promise<CatalogRefreshResult> {
  if (options.force !== true && !(await claimCatalogCheck())) {
    return catalogRefreshResult(false);
  }

  try {
    const models = await fetchCatalogModels();
    const counts = await storeCatalogModels(models);
    return await finaliseCatalogRefresh(counts);
  } catch (err) {
    return failCatalogRefresh(err);
  }
}

/**
 * The catalog refresh a page visit joins. At most one refresh runs per process,
 * and it is cleared when it settles so a later visit can start another. The
 * sync row's timestamp bounds the work across instances; this handle only
 * coalesces the page visits that reach one instance.
 */
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
  benchmarkedAt: string | null;
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
      benchmarkedAt: row.benchmarkedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * True when the catalog knows the model and has retired it. A model missing
 * from the catalog is not retired, so a selection made before the catalog
 * existed still runs; a discouraged model is usable, because Settings only
 * warns about it.
 */
export async function modelIsRetired(modelId: string): Promise<boolean> {
  const rows = await db
    .select({ retired: llmModels.retired })
    .from(llmModels)
    .where(eq(llmModels.id, modelId))
    .limit(1);
  return rows[0]?.retired ?? false;
}
