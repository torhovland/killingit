import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NutritionChart } from "./NutritionChart";

describe("NutritionChart", () => {
  it("draws logged calories as bars and the needed calories as a line", () => {
    const html = renderToStaticMarkup(
      <NutritionChart
        today="2026-11-07"
        days={[
          {
            date: "2026-11-05",
            consumedKcal: 2200,
            neededKcal: 2400,
          },
          {
            date: "2026-11-06",
            consumedKcal: 2600,
            neededKcal: 2500,
          },
          {
            date: "2026-11-07",
            consumedKcal: null,
            neededKcal: 2450,
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="nutrition-chart"');
    expect(html).toContain('data-series="consumed"');
    expect(html).toContain('data-series="needed"');
    expect(html).toContain("Logged");
    expect(html).toContain("Needed");
  });

  it("hides itself when there is no nutrition data", () => {
    const html = renderToStaticMarkup(
      <NutritionChart
        today="2026-11-07"
        days={[
          {
            date: "2026-11-07",
            consumedKcal: null,
            neededKcal: null,
          },
        ]}
      />,
    );

    expect(html).toBe("");
  });
});
