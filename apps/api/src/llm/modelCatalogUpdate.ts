import type { LlmModel, LlmModelGrade } from "@killingit/shared";
import { aliasTargetChanged, pricingChanged } from "./modelCatalogPricing.js";

/** The stored columns a catalog refresh compares against. */
export interface CatalogPriorModel {
  ability: LlmModelGrade;
  aliasTargetSlug: string | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
}

/** The columns that always take the provider's current values. */
interface CatalogIdentity {
  name: string;
  aliasTargetSlug: string | null;
  retired: false;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
}

/** IDs the provider no longer lists; an empty incoming list removes nothing. */
export function catalogIdsToRemove(
  existingIds: readonly string[],
  incomingIds: ReadonlySet<string>,
): string[] {
  if (incomingIds.size === 0) return [];
  return existingIds.filter((id) => !incomingIds.has(id));
}

/** A new catalog row: ungraded, with a price grade until the benchmark runs. */
export interface NewCatalogModel extends CatalogIdentity {
  id: string;
  discouraged: false;
  ability: "?";
  speed: "?";
  cost: LlmModelGrade;
  benchmarkCostUsd: number | null;
}

/**
 * An existing row's changed columns. Omitted columns keep their value, which is
 * how a graded model survives a refresh unless something invalidates its score.
 */
export interface CatalogModelPatch extends CatalogIdentity {
  ability?: LlmModelGrade;
  speed?: LlmModelGrade;
  cost?: LlmModelGrade;
  discouraged?: boolean;
  needsRescore?: boolean;
  benchmarkScore?: null;
  benchmarkTimeMs?: null;
  benchmarkCostUsd?: number | null;
  benchmarkCategories?: null;
  benchmarkedAt?: null;
}

/** The write one provider model needs: a new row, or a patch and its counters. */
export type CatalogModelChange =
  | { action: "insert"; values: NewCatalogModel }
  | {
      action: "update";
      values: CatalogModelPatch;
      /** The list price moved, so the cost grade now comes from the price. */
      rescored: boolean;
      /** The alias now resolves to a different concrete model. */
      reassigned: boolean;
    };

/**
 * Decides the row a catalog refresh writes for one provider model. A model the
 * catalog has not seen is inserted ungraded with a price grade. An existing
 * model keeps its benchmark grades unless its alias target moved, because the
 * old score no longer describes the new target; it is then reset to ungraded
 * and marked for a new benchmark. A price change only re-derives the cost grade
 * of a graded model and asks the benchmark for its measured cost. The first
 * price observation is not a change.
 */
export function catalogUpdateFor(
  prior: CatalogPriorModel | null,
  model: LlmModel,
  price: LlmModelGrade,
  estimatedCost: number | null,
): CatalogModelChange {
  const identity = {
    name: model.name,
    aliasTargetSlug: model.aliasTargetSlug,
    retired: false as const,
    promptPricePerMillion: model.promptPricePerMillion,
    completionPricePerMillion: model.completionPricePerMillion,
  };
  if (prior === null) {
    return {
      action: "insert",
      values: {
        ...identity,
        id: model.id,
        discouraged: false,
        ability: "?",
        speed: "?",
        cost: price,
        benchmarkCostUsd: estimatedCost,
      },
    };
  }

  const priceChanged = pricingChanged(
    prior.promptPricePerMillion,
    prior.completionPricePerMillion,
    model.promptPricePerMillion,
    model.completionPricePerMillion,
  );
  const reassigned = aliasTargetChanged(
    prior.aliasTargetSlug,
    model.aliasTargetSlug,
  );
  const values: CatalogModelPatch = { ...identity };
  if (reassigned) {
    values.ability = "?";
    values.speed = "?";
    values.cost = price;
    values.discouraged = false;
    values.needsRescore = true;
    values.benchmarkScore = null;
    values.benchmarkTimeMs = null;
    values.benchmarkCostUsd = estimatedCost;
    values.benchmarkCategories = null;
    values.benchmarkedAt = null;
  } else if (prior.ability === "?") {
    values.cost = price;
    values.benchmarkCostUsd = estimatedCost;
  } else if (priceChanged) {
    values.cost = price;
    values.needsRescore = true;
  }
  return {
    action: "update",
    values,
    rescored: priceChanged,
    reassigned,
  };
}
