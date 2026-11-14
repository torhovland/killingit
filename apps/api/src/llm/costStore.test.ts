import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { db } from "../db/index.js";
import {
  loadLlmCosts,
  type LlmCostCallRow,
  type LlmCostModelRow,
} from "./costStore.js";

const models: LlmCostModelRow[] = [
  {
    id: "openai/gpt",
    name: "GPT",
    promptPricePerMillion: 2,
    completionPricePerMillion: 8,
  },
  {
    id: "anthropic/claude",
    name: "Claude",
    promptPricePerMillion: null,
    completionPricePerMillion: null,
  },
];

/**
 * A query builder that resolves to the supplied rows whether the caller awaits
 * it directly or after `.where(...)`. `loadLlmCosts` reads the call log with a
 * filter and the model catalog without one.
 */
function rowsQuery(rows: readonly unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    where: () => Promise.resolve(rows),
  });
}

const select = spyOn(db, "select");

afterEach(() => {
  select.mockReset();
});

/**
 * Replaces the two database reads `loadLlmCosts` makes with the supplied rows,
 * so the cost aggregation runs as the production consumer of the call log.
 */
function stubCostRows(
  calls: readonly LlmCostCallRow[],
  catalog: readonly LlmCostModelRow[],
): void {
  select.mockImplementationOnce(rowsQueryFor(calls));
  select.mockImplementationOnce(rowsQueryFor(catalog));
}

/** A `db.select` implementation that resolves to the supplied rows. */
function rowsQueryFor(rows: readonly unknown[]): typeof db.select {
  return (() => ({
    from: () => rowsQuery(rows),
  })) as unknown as typeof db.select;
}

describe("loadLlmCosts", () => {
  it("groups the reported charge by routed model, month, and day", async () => {
    stubCostRows(
      [
        {
          createdAt: new Date("2026-11-01T10:00:00Z"),
          kind: "season_plan",
          model: "~openai/alias",
          usage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            costUsd: 0.25,
          },
          metadata: { responseModel: "openai/gpt" },
        },
        {
          createdAt: new Date("2026-11-01T18:00:00Z"),
          kind: "daily_update",
          model: "openai/gpt",
          usage: {
            promptTokens: 50,
            completionTokens: 10,
            totalTokens: 60,
            costUsd: 0.1,
          },
          metadata: {},
        },
        {
          createdAt: new Date("2026-10-31T23:59:00Z"),
          kind: "season_plan",
          model: "anthropic/claude",
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            costUsd: 0.05,
          },
          metadata: {},
        },
      ],
      models,
    );

    const costs = await loadLlmCosts(1);

    expect(costs.monthly).toEqual([
      {
        bucket: "2026-10",
        model: "anthropic/claude",
        label: "Claude",
        kind: "season_plan",
        costUsd: 0.05,
        calls: 1,
      },
      {
        bucket: "2026-11",
        model: "openai/gpt",
        label: "GPT",
        kind: "daily_update",
        costUsd: 0.1,
        calls: 1,
      },
      {
        bucket: "2026-11",
        model: "openai/gpt",
        label: "GPT",
        kind: "season_plan",
        costUsd: 0.25,
        calls: 1,
      },
    ]);
    expect(costs.daily).toEqual([
      {
        bucket: "2026-10-31",
        model: "anthropic/claude",
        label: "Claude",
        kind: "season_plan",
        costUsd: 0.05,
        calls: 1,
      },
      {
        bucket: "2026-11-01",
        model: "openai/gpt",
        label: "GPT",
        kind: "daily_update",
        costUsd: 0.1,
        calls: 1,
      },
      {
        bucket: "2026-11-01",
        model: "openai/gpt",
        label: "GPT",
        kind: "season_plan",
        costUsd: 0.25,
        calls: 1,
      },
    ]);
  });

  it("estimates a call without a reported charge from list prices", async () => {
    stubCostRows(
      [
        {
          createdAt: new Date("2026-11-02T08:00:00Z"),
          kind: "activity_analysis",
          model: "openai/gpt",
          usage: {
            promptTokens: 1_000_000,
            completionTokens: 500_000,
            totalTokens: 1_500_000,
          },
          metadata: {},
        },
      ],
      models,
    );

    const costs = await loadLlmCosts(1);

    expect(costs.monthly[0]?.costUsd).toBe(6);
    expect(costs.daily[0]?.costUsd).toBe(6);
  });

  it("counts a call with no usage or price as zero cost", async () => {
    stubCostRows(
      [
        {
          createdAt: new Date("2026-11-02T08:00:00Z"),
          kind: "coach_reply",
          model: "anthropic/claude",
          usage: null,
          metadata: {},
        },
        {
          createdAt: new Date("2026-11-02T09:00:00Z"),
          kind: "food_analysis",
          model: "removed/gone",
          usage: {
            promptTokens: 1_000,
            completionTokens: 100,
            totalTokens: 1_100,
          },
          metadata: { responseModel: "removed/from-catalog" },
        },
      ],
      models,
    );

    const costs = await loadLlmCosts(1);

    expect(costs.monthly).toEqual([
      {
        bucket: "2026-11",
        model: "anthropic/claude",
        label: "Claude",
        kind: "coach_reply",
        costUsd: 0,
        calls: 1,
      },
      {
        bucket: "2026-11",
        model: "removed/from-catalog",
        label: "removed/from-catalog",
        kind: "food_analysis",
        costUsd: 0,
        calls: 1,
      },
    ]);
  });
});
