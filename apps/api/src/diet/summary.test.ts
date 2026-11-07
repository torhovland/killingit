import { describe, expect, it } from "bun:test";
import type { FoodAnalysis } from "@killingit/shared";
import { summarizeDiet, type DietSourceEntry } from "./summary.js";

function analysis(overrides: Partial<FoodAnalysis> = {}): FoodAnalysis {
  return {
    meal: "Porridge",
    carbsGrams: 60,
    proteinGrams: 20,
    fatGrams: 10,
    caloriesKcal: 400,
    dietFit: "Good fuelling.",
    ...overrides,
  };
}

function entry(
  eatenDate: string,
  eatenTime = "08:00",
  overrides: Partial<DietSourceEntry> = {},
): DietSourceEntry {
  return {
    eatenDate,
    eatenTime,
    description: "Breakfast",
    analysis: analysis(),
    analysisError: null,
    ...overrides,
  };
}

describe("summarizeDiet", () => {
  it("lists meals from the last seven days, most recent first", () => {
    const context = summarizeDiet(
      [
        entry("2026-11-07", "12:30"),
        entry("2026-11-01", "08:00"),
        entry("2026-10-31", "08:00"),
      ],
      "2026-11-07",
    );

    expect(context.meals.map((meal) => meal.eatenDate)).toEqual([
      "2026-11-07",
      "2026-11-01",
    ]);
  });

  it("summarises each completed week with averages per logged day", () => {
    const context = summarizeDiet(
      [
        entry("2026-10-26", "08:00"),
        entry("2026-10-27", "08:00", {
          analysis: analysis({ carbsGrams: 80, proteinGrams: 30 }),
        }),
        // A meal without an analysis still counts as logged, but not in the
        // nutrition averages.
        entry("2026-10-28", "08:00", { analysis: null }),
      ],
      "2026-11-07",
    );

    expect(context.weeks).toHaveLength(1);
    const week = context.weeks.find(
      (summary) => summary.weekStart === "2026-10-26",
    );
    expect(week).toMatchObject({
      meals: 3,
      daysLogged: 3,
      nutritionDays: 2,
      carbsGramsPerDay: 70,
      proteinGramsPerDay: 25,
      fatGramsPerDay: 10,
      caloriesKcalPerDay: 400,
    });
  });

  it("does not summarise the current, still-running week", () => {
    const context = summarizeDiet(
      [entry("2026-11-02"), entry("2026-11-03")],
      "2026-11-07",
    );
    expect(context.weeks).toEqual([]);
  });

  it("drops meals older than a year and caps the weekly summaries", () => {
    const entries: DietSourceEntry[] = [entry("2025-10-01")];
    for (let index = 0; index < 60; index += 1) {
      const date = new Date(Date.UTC(2025, 0, 6 + index * 7));
      entries.push(entry(date.toISOString().slice(0, 10)));
    }

    const context = summarizeDiet(entries, "2026-11-07");
    expect(context.weeks.length).toBeLessThanOrEqual(52);
    expect(context.weeks.every((week) => week.weekStart >= "2025-11-07")).toBe(
      true,
    );
  });

  it("keeps meals without an analysis in the recent list", () => {
    const context = summarizeDiet(
      [
        entry("2026-11-07", "08:00", {
          analysis: null,
          analysisError: "No model",
        }),
      ],
      "2026-11-07",
    );
    expect(context.meals[0]?.analysis).toBeNull();
    expect(context.meals[0]?.analysisError).toBe("No model");
  });
});
