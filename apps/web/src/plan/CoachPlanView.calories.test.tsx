import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { noPending, plan } from "../testFixtures/plan";

describe("CoachPlanView calories", () => {
  it("shows diet progress targets on the week, block and season tabs", () => {
    const withProgress: CoachPlan = {
      ...plan,
      season: {
        ...plan.season,
        dietProgress: {
          targetWeightKg: 78,
          targetBodyFatPercent: 15,
          note: "Reach race weight by the season end.",
        },
        blocks: plan.season.blocks.map((block) => ({
          ...block,
          dietProgress: {
            targetWeightKg: 80,
            targetBodyFatPercent: 18,
            note: "Hold weight while building volume.",
          },
        })),
      },
      block: {
        ...plan.block,
        dietProgress: {
          targetWeightKg: 80.5,
          targetBodyFatPercent: 18,
          note: "Hold weight through the block.",
        },
        weeks: plan.block.weeks.map((week) => ({
          ...week,
          dietProgress: {
            targetWeightKg: 81,
            targetBodyFatPercent: 18,
            note: "Hold weight through the week.",
          },
        })),
      },
      week: {
        ...plan.week,
        dietProgress: {
          targetWeightKg: 81.5,
          targetBodyFatPercent: 18,
          note: "Hold weight through the week.",
        },
      },
    };

    const week = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={withProgress}
        defaultTab="week"
        showCalories
      />,
    );
    expect(week).toContain('data-testid="week-diet-progress"');
    expect(week).toContain("Diet target by the end of the week:");
    expect(week).toContain("81.5 kg and 18.0 % body fat");
    expect(week).toContain("Hold weight through the week.");

    const block = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={withProgress}
        defaultTab="block"
        showCalories
      />,
    );
    expect(block).toContain('data-testid="block-diet-progress"');
    expect(block).toContain("Diet target by the end of the block:");
    expect(block).toContain("80.5 kg and 18.0 % body fat");
    expect(block).toContain('data-testid="block-week-diet-progress"');
    expect(block).toContain("81.0 kg and 18.0 % body fat");

    const season = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={withProgress}
        defaultTab="season"
        showCalories
      />,
    );
    expect(season).toContain('data-testid="season-diet-progress"');
    expect(season).toContain("Diet target by the end of the season:");
    expect(season).toContain("78.0 kg and 15.0 % body fat");
    expect(season).toContain('data-testid="season-block-diet-progress"');
    expect(season).toContain("80.0 kg and 18.0 % body fat");
  });

  it("hides diet progress when diet advice is off", () => {
    const withProgress: CoachPlan = {
      ...plan,
      week: {
        ...plan.week,
        dietProgress: {
          targetWeightKg: 81.5,
          targetBodyFatPercent: 18,
          note: "Hold weight.",
        },
      },
    };
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={withProgress}
        defaultTab="week"
      />,
    );
    expect(html).not.toContain("Diet target by the end of the week:");
  });

  it("shows today's needed, logged and remaining calories", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          today: { ...plan.today, estimatedCaloriesKcal: 2400 },
        }}
        showCalories
        dietToday={{
          date: "2026-10-21",
          neededCaloriesKcal: 2400,
          calorieBreakdown: {
            basalMetabolismKcal: 1900,
            workoutCaloriesKcal: 500,
            dietDeficitKcal: 0,
          },
          consumedCaloriesKcal: 1500,
          balanceKcal: -900,
          entries: [],
        }}
      />,
    );

    expect(html).toContain('data-testid="plan-today-calories-breakdown"');
    expect(html).toContain("Base metabolism");
    expect(html).toContain("Workout requirement");
    expect(html).toContain("Allocated today");
    expect(html).toContain("2400 kcal");
    expect(html).toContain("1500 kcal");
    expect(html).toContain("900 kcal");
  });

  it("shows the estimated calorie requirement on each week session", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          week: {
            ...plan.week,
            sessions: plan.week.sessions.map((session, index) => ({
              ...session,
              estimatedCaloriesKcal: 2200 + index * 100,
            })),
          },
        }}
        defaultTab="week"
        showCalories
      />,
    );

    expect(html).toContain('data-testid="week-session-calories"');
    expect(html).toContain("2200 kcal needed");
    expect(html).toContain("2800 kcal needed");
  });

  it("does not show an implausibly low calorie target", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          today: { ...plan.today, estimatedCaloriesKcal: 480 },
        }}
        showCalories
        dietToday={null}
      />,
    );

    expect(html).not.toContain("480 kcal");
    expect(html).not.toContain('data-testid="plan-today-calories"');
  });
});
