import { describe, expect, it } from "bun:test";
import type { FoodAnalysis } from "@killingit/shared";
import { buildDietSummary, consumedCaloriesByDate } from "./days.js";
import type { StoredFoodEntry } from "./store.js";

const analysis = (caloriesKcal: number): FoodAnalysis => ({
  meal: "A meal",
  carbsGrams: 50,
  proteinGrams: 20,
  fatGrams: 10,
  caloriesKcal,
  dietFit: "Fits the goal.",
});

function entry(
  id: number,
  eatenDate: string,
  caloriesKcal: number | null,
): StoredFoodEntry {
  return {
    id,
    eatenAt: new Date(`${eatenDate}T12:00:00Z`),
    eatenDate,
    eatenTime: "12:00",
    description: "A meal",
    thumbnailDataUrl: null,
    analysis: caloriesKcal === null ? null : analysis(caloriesKcal),
    model: "test/model",
    analysisError: caloriesKcal === null ? "No model." : null,
    createdAt: new Date(`${eatenDate}T12:00:00Z`),
  };
}

describe("consumedCaloriesByDate", () => {
  it("sums analysed meals and ignores unanalysed ones", () => {
    const totals = consumedCaloriesByDate([
      entry(1, "2026-11-07", 410),
      entry(2, "2026-11-07", 300),
      entry(3, "2026-11-07", null),
      entry(4, "2026-11-06", 500),
    ]);
    expect(totals.get("2026-11-07")).toBe(710);
    expect(totals.get("2026-11-06")).toBe(500);
  });
});

describe("buildDietSummary", () => {
  it("groups days newest first and pairs them with the calorie target", () => {
    const summary = buildDietSummary({
      entries: [
        entry(1, "2026-11-07", 410),
        entry(2, "2026-11-07", 300),
        entry(3, "2026-11-06", 500),
        entry(4, "2026-11-05", null),
      ],
      targets: new Map([
        ["2026-11-07", 2400],
        ["2026-11-05", 2300],
        ["2026-11-04", 2200],
      ]),
      goal: "Lose 3 kg",
      assessment: "On track.",
      today: "2026-11-04",
    });

    expect(summary.goal).toBe("Lose 3 kg");
    expect(summary.assessment).toBe("On track.");
    expect(summary.days.map((day) => day.date)).toEqual([
      "2026-11-07",
      "2026-11-06",
      "2026-11-05",
      "2026-11-04",
    ]);
    expect(summary.days[0]).toMatchObject({
      date: "2026-11-07",
      neededCaloriesKcal: 2400,
      consumedCaloriesKcal: 710,
      balanceKcal: -1690,
    });
    // A target-only day is still returned, so the page can show the plan.
    expect(summary.days[3]).toMatchObject({
      date: "2026-11-04",
      neededCaloriesKcal: 2200,
      consumedCaloriesKcal: null,
      balanceKcal: null,
    });
    // An unanalysed-only day has no consumed total.
    expect(summary.days[2]).toMatchObject({
      consumedCaloriesKcal: null,
      balanceKcal: null,
    });
  });
});
