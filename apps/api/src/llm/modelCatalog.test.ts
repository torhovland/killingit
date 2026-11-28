import { describe, expect, it } from "bun:test";
import {
  abilityGrade,
  costGrade,
  isDiscouraged,
  speedGrade,
} from "./modelCatalog.js";
import { catalogIdsToRemove } from "./modelCatalogUpdate.js";
import {
  aliasTargetChanged,
  estimateBenchmarkCost,
  priceGrade,
  pricingChanged,
} from "./modelCatalogPricing.js";

describe("abilityGrade", () => {
  it("maps the revision-plus-goal score bands to letter grades", () => {
    expect(abilityGrade({ score: 10.6 })).toBe("A+");
    expect(abilityGrade({ score: 10.5 })).toBe("A+");
    expect(abilityGrade({ score: 10.4 })).toBe("A");
    expect(abilityGrade({ score: 10.0 })).toBe("A");
    expect(abilityGrade({ score: 9.9 })).toBe("B");
    expect(abilityGrade({ score: 9.5 })).toBe("B");
    expect(abilityGrade({ score: 9.4 })).toBe("C");
    expect(abilityGrade({ score: 9.0 })).toBe("C");
    expect(abilityGrade({ score: 8.9 })).toBe("D");
    expect(abilityGrade({ score: 8.5 })).toBe("D");
    expect(abilityGrade({ score: 8.4 })).toBe("E");
    expect(abilityGrade({ score: 0.1 })).toBe("E");
  });

  it("grades a failed run as F", () => {
    expect(abilityGrade({ score: 12, failed: true })).toBe("F");
  });

  it("does not grade an unbenchmarked model", () => {
    expect(abilityGrade({ score: null })).toBe("F");
  });
});

describe("speedGrade", () => {
  it("maps elapsed time to letter grades", () => {
    expect(speedGrade(59_999)).toBe("A+");
    expect(speedGrade(60_000)).toBe("A");
    expect(speedGrade(120_000)).toBe("B");
    expect(speedGrade(180_000)).toBe("C");
    expect(speedGrade(240_000)).toBe("D");
    expect(speedGrade(300_000)).toBe("E");
    expect(speedGrade(600_000)).toBe("F");
    expect(speedGrade(null)).toBe("?");
  });
});

describe("costGrade", () => {
  it("maps cost bands to letter grades", () => {
    expect(costGrade(0.014)).toBe("A+");
    expect(costGrade(0.015)).toBe("A");
    expect(costGrade(0.04)).toBe("B");
    expect(costGrade(0.1)).toBe("C");
    expect(costGrade(0.15)).toBe("D");
    expect(costGrade(0.35)).toBe("E");
    expect(costGrade(2.49)).toBe("E");
    expect(costGrade(2.5)).toBe("F");
    expect(costGrade(null)).toBe("?");
  });
});

describe("isDiscouraged", () => {
  it("discourages ability below B, speed F and cost F", () => {
    expect(isDiscouraged("C", "A", "A")).toBe(true);
    expect(isDiscouraged("B", "F", "A")).toBe(true);
    expect(isDiscouraged("B", "A", "F")).toBe(true);
    expect(isDiscouraged("B", "E", "E")).toBe(false);
  });

  it("discourages when a known grade disqualifies, even if another is ungraded", () => {
    expect(isDiscouraged("C", "?", "A")).toBe(true);
    expect(isDiscouraged("?", "F", "A")).toBe(true);
    expect(isDiscouraged("?", "?", "F")).toBe(true);
  });

  it("does not discourage when no known grade disqualifies", () => {
    expect(isDiscouraged("?", "?", "A")).toBe(false);
    expect(isDiscouraged("B", "?", "A")).toBe(false);
    expect(isDiscouraged("B", "E", "E")).toBe(false);
  });
});

describe("priceGrade", () => {
  it("leaves a routed model ungraded", () => {
    expect(priceGrade(null, 10)).toBe("?");
    expect(priceGrade(10, null)).toBe("?");
    expect(priceGrade(-1, -1)).toBe("?");
  });

  it("grades free and very cheap models A+", () => {
    expect(priceGrade(0, 0)).toBe("A+");
    expect(priceGrade(0.09, 0.49)).toBe("A+");
  });

  it("applies the fixed F limits on either price", () => {
    expect(priceGrade(20, 0.1)).toBe("F");
    expect(priceGrade(0.1, 100)).toBe("F");
    expect(priceGrade(19.99, 99.99)).toBe("E");
  });

  it("moves through the middle bands at their limits", () => {
    expect(priceGrade(0.1, 0.5)).toBe("A");
    expect(priceGrade(0.32, 1.6)).toBe("B");
    expect(priceGrade(0.8, 4)).toBe("C");
    expect(priceGrade(2, 10)).toBe("D");
    expect(priceGrade(3, 15)).toBe("E");
  });
});

describe("estimateBenchmarkCost", () => {
  it("leaves an unpriced model without an estimate", () => {
    expect(estimateBenchmarkCost(null, null)).toBeNull();
  });

  it("estimates both benchmark prompts with a missing side as zero", () => {
    expect(estimateBenchmarkCost(1, 2)).toBeCloseTo(0.048);
    expect(estimateBenchmarkCost(1, null)).toBeCloseTo(0.028);
    expect(estimateBenchmarkCost(null, 2)).toBeCloseTo(0.02);
  });
});

describe("pricingChanged", () => {
  it("detects a change in either price", () => {
    expect(pricingChanged(1, 2, 1, 2)).toBe(false);
    expect(pricingChanged(1, 2, 1.5, 2)).toBe(true);
    expect(pricingChanged(1, 2, 1, 3)).toBe(true);
  });

  it("does not treat the first price observation as a change", () => {
    expect(pricingChanged(null, null, 1, 2)).toBe(false);
    expect(pricingChanged(1, 2, null, null)).toBe(false);
  });
});

describe("aliasTargetChanged", () => {
  it("detects when a known alias points at a different model", () => {
    expect(
      aliasTargetChanged(
        "deepseek/deepseek-v4.1-flash-1017",
        "deepseek/deepseek-v4.1-flash-1101",
      ),
    ).toBe(true);
    expect(
      aliasTargetChanged(
        "deepseek/deepseek-v4.1-flash-1017",
        "deepseek/deepseek-v4.1-flash-1017",
      ),
    ).toBe(false);
  });

  it("does not treat an unknown alias target as a change", () => {
    expect(aliasTargetChanged(null, "deepseek/deepseek-v4.1-flash-1017")).toBe(
      false,
    );
    expect(aliasTargetChanged("deepseek/deepseek-v4.1-flash-1017", null)).toBe(
      false,
    );
  });
});

describe("catalogIdsToRemove", () => {
  it("removes rows the provider no longer lists", () => {
    expect(
      catalogIdsToRemove(
        [
          { id: "a/model", aliasTargetSlug: null },
          { id: "b/model", aliasTargetSlug: null },
          { id: "c/model", aliasTargetSlug: null },
        ],
        new Set(["a/model", "c/model"]),
      ),
    ).toEqual(["b/model"]);
  });

  it("removes meta models whose target was removed or is missing", () => {
    expect(
      catalogIdsToRemove(
        [
          { id: "a/model", aliasTargetSlug: null },
          { id: "~a/latest", aliasTargetSlug: "a/model" },
          { id: "~gone/latest", aliasTargetSlug: "gone/model" },
          { id: "b/model", aliasTargetSlug: null },
          { id: "~b/latest", aliasTargetSlug: "b/model" },
        ],
        new Set(["a/model"]),
      ),
    ).toEqual(["b/model", "~gone/latest", "~b/latest"]);
  });

  it("removes a meta model with no target", () => {
    expect(
      catalogIdsToRemove(
        [{ id: "~empty/latest", aliasTargetSlug: null }],
        new Set(["a/model"]),
      ),
    ).toEqual(["~empty/latest"]);
  });

  it("removes nothing when the incoming list is empty", () => {
    expect(
      catalogIdsToRemove([{ id: "a/model", aliasTargetSlug: null }], new Set()),
    ).toEqual([]);
  });
});
