import { describe, expect, it } from "bun:test";
import type { LlmCatalogModel } from "@killingit/shared";
import { modelMatchesFilters, type LlmModelFilters } from "./LlmSection";

function model(overrides: Partial<LlmCatalogModel> = {}): LlmCatalogModel {
  return {
    id: "test/model",
    name: "Test Model",
    retired: false,
    discouraged: false,
    ability: "A",
    speed: "A",
    cost: "A",
    benchmarkScore: 11,
    benchmarkTimeMs: 10_000,
    benchmarkCostUsd: 0.01,
    ...overrides,
  };
}

function filters(overrides: Partial<LlmModelFilters> = {}): LlmModelFilters {
  return {
    includeUngraded: true,
    showDiscouraged: false,
    minAbility: "B",
    minSpeed: "D",
    minCost: "E",
    ...overrides,
  };
}

describe("modelMatchesFilters", () => {
  it("lets an ungraded grade through only when the box is checked", () => {
    const ungraded = model({ ability: "?" });

    expect(modelMatchesFilters(ungraded, filters())).toBe(true);
    expect(
      modelMatchesFilters(ungraded, filters({ includeUngraded: false })),
    ).toBe(false);
  });

  it("still applies the other grade filters to an ungraded model", () => {
    const ungradedAbility = model({ ability: "?", cost: "F" });

    expect(modelMatchesFilters(ungradedAbility, filters())).toBe(false);
    expect(
      modelMatchesFilters(ungradedAbility, filters({ minCost: "F" })),
    ).toBe(true);
  });

  it("handles each ungraded grade independently", () => {
    const ungradedSpeed = model({ speed: "?" });

    expect(modelMatchesFilters(ungradedSpeed, filters())).toBe(true);
    expect(
      modelMatchesFilters(ungradedSpeed, filters({ includeUngraded: false })),
    ).toBe(false);
  });

  it("hides discouraged models unless the box is checked", () => {
    const discouraged = model({ discouraged: true });

    expect(modelMatchesFilters(discouraged, filters())).toBe(false);
    expect(
      modelMatchesFilters(discouraged, filters({ showDiscouraged: true })),
    ).toBe(true);
  });

  it("applies the grade minimums", () => {
    expect(modelMatchesFilters(model({ ability: "C" }), filters())).toBe(false);
    expect(modelMatchesFilters(model({ ability: "B" }), filters())).toBe(true);
  });
});
