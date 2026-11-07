import { describe, expect, it } from "bun:test";
import {
  dietPlanSchema,
  dietProgressSchema,
  dietSummaryResponseSchema,
  foodAnalysisSchema,
  foodEntryRequestSchema,
  foodEntrySchema,
  isDefaultDietGoal,
  MIN_PLAUSIBLE_CALORIES_KCAL,
  plausibleCaloriesKcal,
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

  it("records whether the athlete stated the goal", () => {
    expect(
      dietPlanSchema.parse({
        goal: "Lose 3 kg by March",
        goalProvided: true,
        assessment: "On target.",
      }).goalProvided,
    ).toBe(true);
    expect(
      dietPlanSchema.parse({
        goal: "Maintain current weight",
        assessment: "Holding.",
      }).goalProvided,
    ).toBeUndefined();
  });

  it("carries the numeric goal and date the athlete stated", () => {
    const parsed = dietPlanSchema.parse({
      goal: "Lose fat gradually toward 15% body fat by March",
      goalProvided: true,
      goalWeightKg: null,
      goalBodyFatPercent: 15,
      goalDate: "2027-03-01",
      assessment: "On target.",
    });

    expect(parsed.goalBodyFatPercent).toBe(15);
    expect(parsed.goalDate).toBe("2027-03-01");
    expect(parsed.goalWeightKg).toBeNull();
  });

  it("leaves the numeric goal absent on an older plan", () => {
    const parsed = dietPlanSchema.parse({
      goal: "Lose 3 kg by March",
      assessment: "On target.",
    });

    expect(parsed.goalWeightKg).toBeUndefined();
    expect(parsed.goalBodyFatPercent).toBeUndefined();
    expect(parsed.goalDate).toBeUndefined();
  });
});

describe("isDefaultDietGoal", () => {
  it("recognises the default wording, including punctuation", () => {
    expect(isDefaultDietGoal("Maintain current weight")).toBe(true);
    expect(isDefaultDietGoal(" maintain current weight. ")).toBe(true);
    expect(isDefaultDietGoal(null)).toBe(true);
    expect(isDefaultDietGoal(undefined)).toBe(true);
  });

  it("treats a stated goal as custom", () => {
    expect(isDefaultDietGoal("Lose 3 kg by March")).toBe(false);
    expect(isDefaultDietGoal("Hold 78 kg while building strength")).toBe(false);
  });
});

describe("dietProgressSchema", () => {
  it("accepts weight, body fat, or neither with a note", () => {
    expect(
      dietProgressSchema.parse({
        targetWeightKg: 81.5,
        targetBodyFatPercent: 19,
        note: "Lose 3 kg across the base block.",
      }),
    ).toEqual({
      targetWeightKg: 81.5,
      targetBodyFatPercent: 19,
      note: "Lose 3 kg across the base block.",
    });
    expect(
      dietProgressSchema.parse({
        targetWeightKg: null,
        targetBodyFatPercent: null,
        note: "Hold weight through the build block.",
      }),
    ).toEqual({
      targetWeightKg: null,
      targetBodyFatPercent: null,
      note: "Hold weight through the build block.",
    });
  });

  it("rejects an empty note or a non-positive target", () => {
    expect(
      dietProgressSchema.safeParse({
        targetWeightKg: 80,
        targetBodyFatPercent: null,
        note: "  ",
      }).success,
    ).toBe(false);
    expect(
      dietProgressSchema.safeParse({
        targetWeightKg: 0,
        targetBodyFatPercent: null,
        note: "Lose weight.",
      }).success,
    ).toBe(false);
  });
});

describe("dietSummaryResponseSchema", () => {
  it("keeps the day's balance and entries", () => {
    const parsed = dietSummaryResponseSchema.parse({
      goal: "Maintain current weight",
      goalProvided: false,
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
    expect(parsed.goalProvided).toBe(false);
    expect(parsed.days[0]?.balanceKcal).toBe(-300);
  });

  it("defaults the goal-provided flag for older responses", () => {
    expect(
      dietSummaryResponseSchema.parse({ goal: null, assessment: null })
        .goalProvided,
    ).toBe(false);
  });
});

describe("plausibleCaloriesKcal", () => {
  it("hides a value that could be a deficit or burned calories", () => {
    expect(plausibleCaloriesKcal(480)).toBeNull();
    expect(plausibleCaloriesKcal(MIN_PLAUSIBLE_CALORIES_KCAL - 1)).toBeNull();
  });

  it("keeps a whole-day total", () => {
    expect(plausibleCaloriesKcal(MIN_PLAUSIBLE_CALORIES_KCAL)).toBe(
      MIN_PLAUSIBLE_CALORIES_KCAL,
    );
    expect(plausibleCaloriesKcal(2400)).toBe(2400);
    expect(plausibleCaloriesKcal(null)).toBeNull();
    expect(plausibleCaloriesKcal(undefined)).toBeNull();
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
