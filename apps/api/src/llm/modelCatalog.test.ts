import { describe, expect, it } from "bun:test";
import {
  abilityGrade,
  aliasTargetChanged,
  costGrade,
  isDiscouraged,
  priceGrade,
  pricingChanged,
  speedGrade,
} from "./modelCatalog.js";

describe("abilityGrade", () => {
  const categories = {
    contract: 1.5,
    fidelity: 2,
    design: 3,
    rationale: 2,
    grounding: 2,
    detail: 2,
  };

  it("maps score bands to letter grades", () => {
    expect(abilityGrade({ score: 11.1, categories })).toBe("A+");
    expect(abilityGrade({ score: 10.5, categories })).toBe("A");
    expect(abilityGrade({ score: 10.2, categories })).toBe("B");
    expect(abilityGrade({ score: 10.1, categories })).toBe("C");
    expect(abilityGrade({ score: 9.8, categories })).toBe("C");
    expect(abilityGrade({ score: 9.7, categories })).toBe("D");
    expect(abilityGrade({ score: 9.6, categories })).toBe("D");
    expect(abilityGrade({ score: 9.5, categories })).toBe("E");
    expect(abilityGrade({ score: 7.4, categories })).toBe("E");
  });

  it("grades a failed run as F", () => {
    expect(abilityGrade({ score: 12, categories, failed: true })).toBe("F");
  });

  it("grades an otherwise strong run as F when any category is below half", () => {
    expect(
      abilityGrade({
        score: 12,
        categories: { ...categories, detail: 0.9 },
      }),
    ).toBe("F");
  });

  it("does not grade an unbenchmarked model", () => {
    expect(abilityGrade({ score: null, categories: null })).toBe("F");
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

describe("speedGrade", () => {
  it("maps elapsed time to letter grades", () => {
    expect(speedGrade(44_999)).toBe("A+");
    expect(speedGrade(45_000)).toBe("A");
    expect(speedGrade(90_000)).toBe("B");
    expect(speedGrade(180_000)).toBe("C");
    expect(speedGrade(300_000)).toBe("D");
    expect(speedGrade(600_000)).toBe("E");
    expect(speedGrade(1_200_000)).toBe("F");
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

  it("never discourages an ungraded model", () => {
    expect(isDiscouraged("?", "?", "A")).toBe(false);
    expect(isDiscouraged("B", "?", "A")).toBe(false);
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
