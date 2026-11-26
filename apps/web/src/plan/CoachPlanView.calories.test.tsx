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
    expect(week).toContain("Diet target by the end of the week");
    expect(week).toContain("81.5 kg");
    expect(week).toContain("18.0 % body fat");
    expect(week).toContain("Hold weight through the week.");
    expect(week.indexOf("Diet target by the end of the week")).toBeLessThan(
      week.indexOf("Morning Run"),
    );

    const block = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={withProgress}
        defaultTab="block"
        showCalories
      />,
    );
    expect(block).toContain('data-testid="block-diet-progress"');
    expect(block).toContain("Diet target by the end of the block");
    expect(block).toContain("80.5 kg");
    expect(block).toContain("18.0 % body fat");
    expect(block).toContain('data-testid="block-week-diet-progress"');
    expect(block).toContain("81.0 kg");
    expect(block.indexOf("Aerobic base")).toBeLessThan(
      block.indexOf("Hold weight through the week."),
    );
    expect(block.indexOf("Diet target by the end of the block")).toBeLessThan(
      block.indexOf("Establish consistent aerobic volume."),
    );
    expect(block.indexOf("Diet target by the end of the block")).toBeLessThan(
      block.indexOf("Week starting"),
    );

    const season = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={withProgress}
        defaultTab="season"
        showCalories
      />,
    );
    expect(season).toContain('data-testid="season-diet-progress"');
    expect(season).toContain("Diet target by the end of the season");
    expect(season).toContain("78.0 kg");
    expect(season).toContain("15.0 % body fat");
    expect(season).toContain('data-testid="season-block-diet-progress"');
    expect(season).toContain("80.0 kg");
    expect(season.indexOf("Aerobic endurance")).toBeLessThan(
      season.indexOf("Hold weight while building volume."),
    );
    expect(season.indexOf("Aerobic endurance")).toBeLessThan(
      season.indexOf("Diet target by the end of the season"),
    );
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
    expect(html).not.toContain("Diet target by the end of the week");
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

  it("puts a week session's calories below its title and before the status box", () => {
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

    const title = html.indexOf("Mon, Oct 19");
    const calories = html.indexOf("2200 kcal needed");
    expect(title).toBeGreaterThan(-1);
    expect(title).toBeLessThan(calories);
    expect(calories).toBeLessThan(html.indexOf(">completed<"));
  });

  it("hides a diet target line when the period has no numeric target", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          block: {
            ...plan.block,
            dietProgress: {
              targetWeightKg: null,
              targetBodyFatPercent: null,
              note: "No post-February body-composition target was stated; prioritize rebuilding brevet endurance with adequate fueling.",
            },
          },
        }}
        defaultTab="block"
        showCalories
      />,
    );

    expect(html).not.toContain("Diet target by the end of the block");
    expect(html).not.toContain("No post-February body-composition target");
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
