import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DietSummaryResponse } from "@killingit/shared";
import { DietView } from "./DietView";

const summary: DietSummaryResponse = {
  goal: "Lose 3 kg by March",
  goalProvided: true,
  assessment:
    "The tracked weight is coming down steadily; the deficit is right.",
  days: [
    {
      date: "2026-11-07",
      neededCaloriesKcal: 2400,
      consumedCaloriesKcal: 1500,
      balanceKcal: -900,
      entries: [
        {
          id: 1,
          eatenAt: "2026-11-07T12:00:00.000Z",
          eatenDate: "2026-11-07",
          description: "Porridge",
          hasPhoto: false,
          analysis: {
            meal: "A bowl of porridge",
            carbsGrams: 60,
            proteinGrams: 15,
            fatGrams: 8,
            caloriesKcal: 1500,
            dietFit: "Fits the goal.",
          },
          analysisError: null,
        },
      ],
    },
    {
      date: "2026-11-06",
      neededCaloriesKcal: 2500,
      consumedCaloriesKcal: 2700,
      balanceKcal: 200,
      entries: [],
    },
  ],
};

function render(overrides: Partial<Parameters<typeof DietView>[0]> = {}) {
  return renderToStaticMarkup(
    <DietView
      dietAdvice
      summary={summary}
      today="2026-11-07"
      loading={false}
      error={null}
      onRetry={() => undefined}
      onOpenSettings={() => undefined}
      onOpenSurvey={() => undefined}
      {...overrides}
    />,
  );
}

describe("DietView", () => {
  it("puts the coach's goal and assessment at the top", () => {
    const html = render();
    expect(html).toContain('data-testid="diet-goal"');
    expect(html).toContain("Goal:");
    expect(html).toContain("Lose 3 kg by March");
    expect(html).toContain("The tracked weight is coming down steadily");
  });

  it("shows today's needed, logged and remaining calories", () => {
    const html = render();
    expect(html).toContain('data-testid="diet-today-calories"');
    expect(html).toContain("2400 kcal");
    expect(html).toContain("1500 kcal");
    expect(html).toContain("900 kcal");
  });

  it("groups the food log under each day with its deficit or surplus", () => {
    const html = render();
    expect(html).toContain('data-testid="diet-day"');
    expect(html).toContain("900 kcal deficit");
    expect(html).toContain("200 kcal surplus");
    expect(html).toContain("Porridge");
  });

  it("falls back to maintenance when no goal has been set", () => {
    const html = render({
      summary: { goal: null, goalProvided: false, assessment: null, days: [] },
    });
    expect(html).toContain("Maintain current weight");
  });

  it("points a default goal to the Coaching Survey", () => {
    const html = render({
      summary: {
        goal: "Maintain current weight",
        goalProvided: false,
        assessment: null,
        days: [],
      },
    });
    expect(html).toContain('data-testid="diet-default-goal-note"');
    expect(html).toContain("provide your own diet goal on the Coaching Survey");
    expect(html).toContain("Open the Coaching Survey");
  });

  it("does not point a stated goal to the survey", () => {
    expect(render()).not.toContain('data-testid="diet-default-goal-note"');
  });
});
