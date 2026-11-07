import { describe, expect, it } from "bun:test";
import {
  dietPlanSchema,
  dietSummaryResponseSchema,
  foodAnalysisSchema,
  foodEntryRequestSchema,
  foodEntrySchema,
} from "./diet.js";

describe("foodAnalysisSchema", () => {
  it("accepts macro estimates and a diet-fit note", () => {
    const parsed = foodAnalysisSchema.parse({
      meal: "Porridge with berries",
      carbsGrams: 62,
      proteinGrams: 18,
      fatGrams: 9,
      caloriesKcal: 410,
      dietFit: "Good fuelling before a long ride.",
    });
    expect(parsed.carbsGrams).toBe(62);
    expect(parsed.dietFit).toContain("fuelling");
  });

  it("rejects a negative macro estimate", () => {
    expect(
      foodAnalysisSchema.safeParse({
        meal: "Toast",
        carbsGrams: -1,
        proteinGrams: 2,
        fatGrams: 1,
        caloriesKcal: 100,
        dietFit: "Fine.",
      }).success,
    ).toBe(false);
  });
});

describe("dietPlanSchema", () => {
  it("accepts a goal and the coach's assessment", () => {
    const parsed = dietPlanSchema.parse({
      goal: "Lose 3 kg by March",
      assessment: "The weight trend is on target.",
    });
    expect(parsed.goal).toContain("Lose");
  });
});

describe("dietSummaryResponseSchema", () => {
  it("keeps the day's balance and entries", () => {
    const parsed = dietSummaryResponseSchema.parse({
      goal: "Maintain current weight",
      assessment: "Hold the current intake.",
      days: [
        {
          date: "2026-11-07",
          neededCaloriesKcal: 2400,
          consumedCaloriesKcal: 2100,
          balanceKcal: -300,
          entries: [],
        },
      ],
    });
    expect(parsed.days[0]?.balanceKcal).toBe(-300);
  });
});

describe("foodEntryRequestSchema", () => {
  const base = {
    eatenAt: "2026-11-07T12:30:00.000Z",
    description: "A cheese sandwich",
  };
  const photoDataUrl = "data:image/jpeg;base64,QUJD";

  it("accepts a described meal without a photo", () => {
    expect(foodEntryRequestSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a photo alone, with no description", () => {
    expect(
      foodEntryRequestSchema.safeParse({
        eatenAt: base.eatenAt,
        photoDataUrl,
      }).success,
    ).toBe(true);
  });

  it("accepts a blank description when a photo is present", () => {
    expect(
      foodEntryRequestSchema.safeParse({
        ...base,
        description: "   ",
        photoDataUrl,
      }).success,
    ).toBe(true);
  });

  it("rejects a meal with neither a description nor a photo", () => {
    expect(
      foodEntryRequestSchema.safeParse({
        eatenAt: base.eatenAt,
      }).success,
    ).toBe(false);
    expect(
      foodEntryRequestSchema.safeParse({ ...base, description: "   " }).success,
    ).toBe(false);
  });

  it("rejects a photo that is not a supported base64 data URL", () => {
    for (const photoDataUrl of [
      "https://example.com/meal.jpg",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/jpeg;base64,not base64!",
    ]) {
      expect(
        foodEntryRequestSchema.safeParse({
          ...base,
          photoDataUrl,
        }).success,
      ).toBe(false);
    }
  });
});

describe("foodEntrySchema", () => {
  it("accepts a stored meal whose analysis failed", () => {
    const parsed = foodEntrySchema.parse({
      id: 1,
      eatenAt: "2026-11-07T12:30:00.000Z",
      eatenDate: "2026-11-07",
      description: "A cheese sandwich",
      hasPhoto: false,
      analysis: null,
      analysisError: "No model configured.",
    });
    expect(parsed.analysis).toBeNull();
    expect(parsed.analysisError).toBe("No model configured.");
  });

  it("accepts a photo-only meal with no description", () => {
    const parsed = foodEntrySchema.parse({
      id: 2,
      eatenAt: "2026-11-07T12:30:00.000Z",
      eatenDate: "2026-11-07",
      description: null,
      hasPhoto: true,
      analysis: null,
      analysisError: null,
    });
    expect(parsed.description).toBeNull();
    expect(parsed.hasPhoto).toBe(true);
  });
});
