import { describe, expect, it } from "bun:test";
import {
  abilityGrade,
  costGrade,
  isDiscouraged,
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
    expect(abilityGrade({ score: 9, categories })).toBe("B");
    expect(abilityGrade({ score: 8, categories })).toBe("C");
    expect(abilityGrade({ score: 7.5, categories })).toBe("D");
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

describe("speedGrade", () => {
  it("maps elapsed time to letter grades", () => {
    expect(speedGrade(9_999)).toBe("A+");
    expect(speedGrade(10_000)).toBe("A");
    expect(speedGrade(20_000)).toBe("B");
    expect(speedGrade(30_000)).toBe("C");
    expect(speedGrade(45_000)).toBe("D");
    expect(speedGrade(90_000)).toBe("E");
    expect(speedGrade(150_000)).toBe("F");
    expect(speedGrade(null)).toBe("?");
  });
});

describe("costGrade", () => {
  it("maps cost bands to letter grades", () => {
    expect(costGrade(0.009)).toBe("A+");
    expect(costGrade(0.01)).toBe("A");
    expect(costGrade(0.05)).toBe("B");
    expect(costGrade(0.061)).toBe("C");
    expect(costGrade(0.077)).toBe("D");
    expect(costGrade(0.131)).toBe("E");
    expect(costGrade(0.3)).toBe("F");
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
