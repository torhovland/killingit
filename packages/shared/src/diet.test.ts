import { describe, expect, it } from "bun:test";
import {
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

describe("foodEntryRequestSchema", () => {
  const base = {
    eatenAt: "2026-11-07T12:30:00.000Z",
    description: "A cheese sandwich",
  };

  it("accepts a meal without a photo", () => {
    expect(foodEntryRequestSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a JPEG data URL", () => {
    expect(
      foodEntryRequestSchema.safeParse({
        ...base,
        photoDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      }).success,
    ).toBe(true);
  });

  it("rejects a photo that is not a supported base64 data URL", () => {
    for (const photoDataUrl of [
      "https://example.com/meal.jpg",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/jpeg;base64,not base64!",
    ]) {
      expect(
        foodEntryRequestSchema.safeParse({ ...base, photoDataUrl }).success,
      ).toBe(false);
    }
  });

  it("rejects a blank description", () => {
    expect(
      foodEntryRequestSchema.safeParse({ ...base, description: "   " }).success,
    ).toBe(false);
  });
});

describe("foodEntrySchema", () => {
  it("accepts a stored meal whose analysis failed", () => {
    const parsed = foodEntrySchema.parse({
      id: 1,
      eatenAt: "2026-11-07T12:30:00.000Z",
      description: "A cheese sandwich",
      hasPhoto: false,
      analysis: null,
      analysisError: "No model configured.",
    });
    expect(parsed.analysis).toBeNull();
    expect(parsed.analysisError).toBe("No model configured.");
  });
});
