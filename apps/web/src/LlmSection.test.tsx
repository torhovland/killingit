import { describe, expect, it } from "bun:test";
import type { LlmCatalogModel } from "@killingit/shared";
import {
  compareModels,
  discouragedMessage,
  modelMatchesFilters,
  type LlmModelFilters,
} from "./LlmSection";

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
    benchmarkedAt: "2026-10-31T15:40:52.865Z",
    ...overrides,
  };
}

function filters(overrides: Partial<LlmModelFilters> = {}): LlmModelFilters {
  return {
    includeUngraded: true,
    showDiscouraged: false,
    minAbility: "B",
    minSpeed: "D",
    minCost: "D",
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

describe("discouragedMessage", () => {
  it("names the model and tells the athlete to choose another", () => {
    expect(
      discouragedMessage(
        "Google: Nano Banana Pro (Gemini 3 Pro Image Preview)",
      ),
    ).toBe(
      "Google: Nano Banana Pro (Gemini 3 Pro Image Preview) is discouraged. You should choose another model before running the coach.",
    );
  });
});

describe("compareModels", () => {
  it("orders the primary key in the requested direction", () => {
    const a = model({ id: "a", ability: "A" });
    const b = model({ id: "b", ability: "B" });

    expect(compareModels(a, b, "ability", "desc")).toBeLessThan(0);
    expect(compareModels(a, b, "ability", "asc")).toBeGreaterThan(0);
  });

  it("sorts by last scored, keeping unscored models last", () => {
    const older = model({
      id: "older",
      name: "Older",
      benchmarkedAt: "2026-10-01T08:00:00.000Z",
    });
    const newer = model({
      id: "newer",
      name: "Newer",
      benchmarkedAt: "2026-10-31T08:00:00.000Z",
    });
    const unscored = model({
      id: "unscored",
      name: "Unscored",
      benchmarkedAt: null,
    });

    expect(
      [older, unscored, newer]
        .sort((a, b) => compareModels(a, b, "benchmarkedAt", "desc"))
        .map((entry) => entry.name),
    ).toEqual(["Newer", "Older", "Unscored"]);
    expect(
      [older, unscored, newer]
        .sort((a, b) => compareModels(a, b, "benchmarkedAt", "asc"))
        .map((entry) => entry.name),
    ).toEqual(["Older", "Newer", "Unscored"]);
  });

  it("uses ascending model name for ties in both directions", () => {
    const a = model({ id: "a", name: "Alpha", ability: "A" });
    const b = model({ id: "b", name: "Beta", ability: "A" });

    expect(compareModels(a, b, "ability", "desc")).toBeLessThan(0);
    expect(compareModels(a, b, "ability", "asc")).toBeLessThan(0);
  });

  it("uses ascending model name for ties on discouraged", () => {
    const a = model({ id: "a", name: "Alpha", discouraged: false });
    const b = model({ id: "b", name: "Beta", discouraged: false });

    expect(compareModels(a, b, "discouraged", "desc")).toBeLessThan(0);
    expect(compareModels(b, a, "discouraged", "desc")).toBeGreaterThan(0);
  });
});
