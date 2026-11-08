import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CalorieBalancePanel } from "./CalorieBalancePanel";

describe("CalorieBalancePanel", () => {
  it("shows the requirement as base, workout, deficit and allocated", () => {
    const html = renderToStaticMarkup(
      <CalorieBalancePanel
        neededKcal={2100}
        breakdown={{
          basalMetabolismKcal: 1900,
          workoutCaloriesKcal: 500,
          dietDeficitKcal: 300,
        }}
        consumedKcal={1800}
      />,
    );

    expect(html).toContain("Base metabolism");
    expect(html).toContain("1900 kcal");
    expect(html).toContain("Workout requirement");
    expect(html).toContain("+500 kcal");
    expect(html).toContain("Diet deficit");
    expect(html).toContain("−300 kcal");
    expect(html).toContain("Allocated today");
    expect(html).toContain("2100 kcal");
    expect(html).toContain("300 kcal");
    expect(html).toContain("These are estimates");
  });

  it("labels a negative deficit as a surplus and adds it", () => {
    const html = renderToStaticMarkup(
      <CalorieBalancePanel
        neededKcal={2600}
        breakdown={{
          basalMetabolismKcal: 1900,
          workoutCaloriesKcal: 500,
          dietDeficitKcal: -200,
        }}
        consumedKcal={null}
      />,
    );

    expect(html).toContain("Diet surplus");
    expect(html).toContain("+200 kcal");
    expect(html).toContain("2600 kcal");
    expect(html).not.toContain("Diet deficit");
  });

  it("shows a maintenance day without a minus sign", () => {
    const html = renderToStaticMarkup(
      <CalorieBalancePanel
        neededKcal={2400}
        breakdown={{
          basalMetabolismKcal: 1900,
          workoutCaloriesKcal: 500,
          dietDeficitKcal: 0,
        }}
        consumedKcal={null}
      />,
    );

    expect(html).toContain("Diet deficit");
    expect(html).toContain("0 kcal");
    expect(html).not.toContain("−0 kcal");
  });

  it("falls back to the single required value without a breakdown", () => {
    const html = renderToStaticMarkup(
      <CalorieBalancePanel neededKcal={2400} consumedKcal={null} />,
    );

    expect(html).toContain("Needed");
    expect(html).toContain("2400 kcal");
    expect(html).not.toContain("Base metabolism");
  });
});
