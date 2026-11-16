import { describe, expect, it } from "bun:test";
import type { LlmModel } from "@killingit/shared";
import {
  catalogUpdateFor,
  type CatalogPriorModel,
} from "./modelCatalogUpdate.js";

function catalogModel(overrides: Partial<LlmModel> = {}): LlmModel {
  return {
    id: "deepseek/deepseek-v4.1-flash-1017",
    name: "DeepSeek Flash",
    aliasTargetSlug: null,
    contextLength: null,
    promptPricePerMillion: 0.1,
    completionPricePerMillion: 0.2,
    ...overrides,
  };
}

function storedModel(
  overrides: Partial<CatalogPriorModel> = {},
): CatalogPriorModel {
  return {
    ability: "A",
    aliasTargetSlug: null,
    promptPricePerMillion: 0.1,
    completionPricePerMillion: 0.2,
    ...overrides,
  };
}

const identity = {
  name: "DeepSeek Flash",
  aliasTargetSlug: null,
  retired: false,
  promptPricePerMillion: 0.1,
  completionPricePerMillion: 0.2,
} as const;

describe("catalogUpdateFor", () => {
  it("inserts an unseen model ungraded with a price grade", () => {
    expect(catalogUpdateFor(null, catalogModel(), "A+", 0.01)).toEqual({
      action: "insert",
      values: {
        ...identity,
        id: "deepseek/deepseek-v4.1-flash-1017",
        discouraged: false,
        ability: "?",
        speed: "?",
        cost: "A+",
        benchmarkCostUsd: 0.01,
      },
    });
  });

  it("refreshes an ungraded model's price grade and cost estimate", () => {
    expect(
      catalogUpdateFor(
        storedModel({ ability: "?" }),
        catalogModel(),
        "A+",
        0.015,
      ),
    ).toEqual({
      action: "update",
      values: { ...identity, cost: "A+", benchmarkCostUsd: 0.015 },
      rescored: false,
      reassigned: false,
    });
  });

  it("refreshes names and prices without touching a graded model's grades", () => {
    expect(
      catalogUpdateFor(
        storedModel(),
        catalogModel({ name: "DeepSeek Flash 1017" }),
        "A+",
        0.015,
      ),
    ).toEqual({
      action: "update",
      values: { ...identity, name: "DeepSeek Flash 1017" },
      rescored: false,
      reassigned: false,
    });
  });

  it("moves a graded model's cost to the price grade when its price changes", () => {
    expect(
      catalogUpdateFor(
        storedModel(),
        catalogModel({
          promptPricePerMillion: 0.5,
          completionPricePerMillion: 2,
        }),
        "B",
        0.02,
      ),
    ).toEqual({
      action: "update",
      values: {
        ...identity,
        promptPricePerMillion: 0.5,
        completionPricePerMillion: 2,
        cost: "B",
        needsRescore: true,
      },
      rescored: true,
      reassigned: false,
    });
  });

  it("does not treat the first price observation as a change", () => {
    expect(
      catalogUpdateFor(
        storedModel({
          promptPricePerMillion: null,
          completionPricePerMillion: null,
        }),
        catalogModel(),
        "A+",
        0.015,
      ),
    ).toEqual({
      action: "update",
      values: { ...identity },
      rescored: false,
      reassigned: false,
    });
  });

  it("resets an alias to ungraded when its concrete target moves", () => {
    expect(
      catalogUpdateFor(
        storedModel({
          aliasTargetSlug: "deepseek/deepseek-v4.1-flash-1017",
        }),
        catalogModel({
          id: "~deepseek/deepseek-flash-latest",
          name: "DeepSeek Flash (latest)",
          aliasTargetSlug: "deepseek/deepseek-v4.1-flash-1101",
          promptPricePerMillion: 0.5,
          completionPricePerMillion: 2,
        }),
        "B",
        0.02,
      ),
    ).toEqual({
      action: "update",
      values: {
        name: "DeepSeek Flash (latest)",
        aliasTargetSlug: "deepseek/deepseek-v4.1-flash-1101",
        retired: false,
        promptPricePerMillion: 0.5,
        completionPricePerMillion: 2,
        ability: "?",
        speed: "?",
        cost: "B",
        discouraged: false,
        needsRescore: true,
        benchmarkScore: null,
        benchmarkTimeMs: null,
        benchmarkCostUsd: 0.02,
        benchmarkCategories: null,
        benchmarkedAt: null,
      },
      rescored: true,
      reassigned: true,
    });
  });

  it("takes a target move over an ungraded model and an unchanged price", () => {
    expect(
      catalogUpdateFor(
        storedModel({
          ability: "?",
          aliasTargetSlug: "deepseek/deepseek-v4.1-flash-1017",
        }),
        catalogModel({ aliasTargetSlug: "deepseek/deepseek-v4.1-flash-1101" }),
        "A+",
        0.01,
      ),
    ).toEqual({
      action: "update",
      values: {
        ...identity,
        aliasTargetSlug: "deepseek/deepseek-v4.1-flash-1101",
        ability: "?",
        speed: "?",
        cost: "A+",
        discouraged: false,
        needsRescore: true,
        benchmarkScore: null,
        benchmarkTimeMs: null,
        benchmarkCostUsd: 0.01,
        benchmarkCategories: null,
        benchmarkedAt: null,
      },
      rescored: false,
      reassigned: true,
    });
  });

  it("inserts a routed model ungraded with no cost estimate", () => {
    expect(
      catalogUpdateFor(
        null,
        catalogModel({
          promptPricePerMillion: null,
          completionPricePerMillion: null,
        }),
        "?",
        null,
      ),
    ).toMatchObject({
      values: {
        cost: "?",
        benchmarkCostUsd: null,
        promptPricePerMillion: null,
        completionPricePerMillion: null,
      },
    });
  });
});
