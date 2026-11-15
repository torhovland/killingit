import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { plan } from "./testFixtures/plan";

describe("CoachPlanView refresh", () => {
  it("dims today's stale session and shows a spinner while it is refreshed", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={plan}
        showTomorrow
        refreshingDays={{ today: true, tomorrow: false }}
      />,
    );

    expect(html).toContain('data-testid="plan-today-refreshing"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Updating today");
    expect(html).toContain("animate-spin");
    expect(html).toContain("opacity-40");
    expect(html).not.toContain('data-testid="plan-tomorrow-refreshing"');
  });

  it("dims tomorrow's stale session while it is refreshed", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={plan}
        showTomorrow
        refreshingDays={{ today: true, tomorrow: true }}
      />,
    );

    expect(html).toContain('data-testid="plan-today-refreshing"');
    expect(html).toContain('data-testid="plan-tomorrow-refreshing"');
    expect(html).toContain("Updating tomorrow");
    expect(html.match(/animate-spin/g)).toHaveLength(2);
  });

  it("leaves the days undimmed when no refresh is in flight", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView plan={plan} showTomorrow />,
    );

    expect(html).not.toContain("-refreshing");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain('aria-busy="true"');
  });

  it("dims the current week and shows a spinner while it is refreshed", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={plan}
        defaultTab="week"
        refreshingWeeks={{ week: true }}
      />,
    );

    expect(html).toContain('data-testid="plan-week-refreshing"');
    expect(html).toContain("Updating this week");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("opacity-40");
  });

  it("dims the next week and next block while they are refreshed", () => {
    const nextPlan: CoachPlan = {
      ...plan,
      nextWeek: { ...plan.week, startDate: "2026-10-26" },
      nextBlock: {
        ...plan.block,
        name: "Build",
        startDate: "2026-12-02",
        endDate: "2027-01-15",
      },
    };

    const week = renderToStaticMarkup(
      <CoachPlanView
        plan={nextPlan}
        defaultTab="week"
        refreshingWeeks={{ nextWeek: true }}
      />,
    );
    expect(week).toContain('data-testid="plan-next-week-refreshing"');
    expect(week).toContain("Updating next week");
    expect(week).not.toContain('data-testid="plan-week-refreshing"');

    const block = renderToStaticMarkup(
      <CoachPlanView
        plan={nextPlan}
        defaultTab="block"
        refreshingBlocks={{ nextBlock: true }}
      />,
    );
    expect(block).toContain('data-testid="plan-next-block-refreshing"');
    expect(block).toContain("Updating next block");
    expect(block).not.toContain('data-testid="plan-block-refreshing"');
  });

  it("dims the current block and shows a spinner while it is refreshed", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={plan}
        defaultTab="block"
        refreshingBlocks={{ block: true }}
      />,
    );

    expect(html).toContain('data-testid="plan-block-refreshing"');
    expect(html).toContain("Updating current block");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("opacity-40");
  });
});
