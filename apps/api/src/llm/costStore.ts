import type {
  LlmCallUsage,
  LlmCostBucket,
  LlmCostsResponse,
  LlmPromptKind,
} from "@killingit/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { llmCalls, llmModels } from "../db/schema.js";

/** One stored call, reduced to the fields the cost aggregation needs. */
export interface LlmCostCallRow {
  createdAt: Date;
  /** The coaching task the prompt belongs to. */
  kind: LlmPromptKind;
  /** The model the app asked for; it may be an alias. */
  model: string;
  usage: LlmCallUsage | null;
  metadata: Record<string, unknown>;
}

/** The catalog entry used for display names and fallback list prices. */
export interface LlmCostModelRow {
  id: string;
  name: string;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
}

interface BucketAccumulator {
  model: string;
  label: string;
  kind: LlmPromptKind;
  costUsd: number;
  calls: number;
}

/**
 * Groups the account's prompt log into monthly and daily cost buckets per
 * routed model and prompt kind. OpenRouter reports the charged USD amount on
 * each response and that value is used when present. Calls made before cost
 * capture have to be estimated from their token usage and the catalog's current
 * list price; a model with no known price contributes zero rather than a guess.
 */
export function aggregateLlmCosts(
  calls: readonly LlmCostCallRow[],
  models: readonly LlmCostModelRow[],
): LlmCostsResponse {
  const catalog = new Map(models.map((model) => [model.id, model]));
  const monthly = new Map<string, Map<string, BucketAccumulator>>();
  const daily = new Map<string, Map<string, BucketAccumulator>>();

  for (const call of calls) {
    const routed = responseModel(call.metadata) ?? call.model;
    const catalogEntry = catalog.get(routed) ?? catalog.get(call.model);
    const model = catalogEntry?.id ?? routed;
    const label = catalogEntry?.name ?? routed;
    const costUsd = callCostUsd(call.usage, catalogEntry);

    addCost(
      monthly,
      monthKey(call.createdAt),
      model,
      label,
      call.kind,
      costUsd,
    );
    addCost(daily, dayKey(call.createdAt), model, label, call.kind, costUsd);
  }

  return {
    monthly: flatten(monthly),
    daily: flatten(daily),
  };
}

/** The database-backed cost history for one account. */
export async function loadLlmCosts(userId: number): Promise<LlmCostsResponse> {
  const [calls, models] = await Promise.all([
    db
      .select({
        createdAt: llmCalls.createdAt,
        kind: llmCalls.kind,
        model: llmCalls.model,
        usage: llmCalls.usage,
        metadata: llmCalls.metadata,
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, userId)),
    db
      .select({
        id: llmModels.id,
        name: llmModels.name,
        promptPricePerMillion: llmModels.promptPricePerMillion,
        completionPricePerMillion: llmModels.completionPricePerMillion,
      })
      .from(llmModels),
  ]);

  return aggregateLlmCosts(calls, models);
}

/** The concrete model OpenRouter routed to, when the log recorded it. */
function responseModel(metadata: Record<string, unknown>): string | null {
  const value = metadata.responseModel;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The charged cost when OpenRouter reported it, otherwise the call's token
 * usage at the catalog's list price. A call with no usage or no price is free
 * for accounting purposes, not an error.
 */
function callCostUsd(
  usage: LlmCallUsage | null,
  model: LlmCostModelRow | undefined,
): number {
  if (usage === null) {
    return 0;
  }
  if (usage.costUsd !== null && usage.costUsd !== undefined) {
    return usage.costUsd;
  }
  if (model === undefined) {
    return 0;
  }
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  return (
    (promptTokens * (model.promptPricePerMillion ?? 0)) / 1_000_000 +
    (completionTokens * (model.completionPricePerMillion ?? 0)) / 1_000_000
  );
}

function addCost(
  buckets: Map<string, Map<string, BucketAccumulator>>,
  bucket: string,
  model: string,
  label: string,
  kind: LlmPromptKind,
  costUsd: number,
): void {
  const bySeries = buckets.get(bucket) ?? new Map<string, BucketAccumulator>();
  // One row per model and prompt kind, so the client can stack the same
  // buckets either by which model answered or by what the prompt was for.
  const key = `${model}\u0000${kind}`;
  const entry = bySeries.get(key) ?? {
    model,
    label,
    kind,
    costUsd: 0,
    calls: 0,
  };
  entry.costUsd += costUsd;
  entry.calls += 1;
  bySeries.set(key, entry);
  buckets.set(bucket, bySeries);
}

/** Turns the nested map into flat, period-sorted rows. */
function flatten(
  buckets: Map<string, Map<string, BucketAccumulator>>,
): LlmCostBucket[] {
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([bucket, byModel]) =>
      [...byModel.values()]
        .sort(
          (left, right) =>
            left.model.localeCompare(right.model) ||
            left.kind.localeCompare(right.kind),
        )
        .map((entry) => ({
          bucket,
          model: entry.model,
          label: entry.label,
          kind: entry.kind,
          costUsd: roundCost(entry.costUsd),
          calls: entry.calls,
        })),
    );
}

/** Keeps floating-point drift out of the stored buckets. */
function roundCost(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/** The UTC month (`YYYY-MM`) a call belongs to. */
function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The UTC day (`YYYY-MM-DD`) a call belongs to. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
