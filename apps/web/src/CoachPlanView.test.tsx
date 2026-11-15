import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { BULLET, plan } from "./testFixtures/plan";

describe("CoachPlanView", () => {
  it("shows a dated goal or event on the Day tab", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={plan}
        events={[
          {
            startDate: "2026-10-21",
            endDate: null,
            title: "Oslo Marathon",
            kind: "race",
          },
        ]}
      />,
    );

    expect(html).toContain('data-testid="plan-today-events"');
    expect(html).toContain("Oslo Marathon");
    expect(html).toContain("Race");
  });

  it("renders today's session, alternatives, and rationale", () => {
    const html = renderToStaticMarkup(<CoachPlanView plan={plan} />);

    expect(html).toContain("Today");
    expect(html).toContain("Easy run");
    expect(html).toContain("45 min");
    expect(html).toContain("Cross-train for 45 minutes.");
    expect(html).toContain("Easy aerobic work supports recovery.");
  });

  it("renders lists in the daily description and rationale as HTML lists", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: {
            ...plan.today,
            description: "Main set:\n- 10 minutes easy\n- 4 x 5 minutes hard",
            rationale: "Why this works:\n1. Builds the base\n2. Sharpens speed",
          },
        }}
      />,
    );

    expect(html).toContain("<ul");
    expect(html).toContain("<li>10 minutes easy</li>");
    expect(html).toContain("<li>4 x 5 minutes hard</li>");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>Builds the base</li>");
    expect(html).toContain("<li>Sharpens speed</li>");
    expect(html).not.toContain("- 10 minutes easy");
  });

  it("shows the four plan tabs with Day selected by default", () => {
    const html = renderToStaticMarkup(<CoachPlanView plan={plan} />);

    expect(html).toContain('role="tablist"');
    expect(html).toContain("Day");
    expect(html).toContain("Week");
    expect(html).toContain("Block");
    expect(html).toContain("Season");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('data-testid="plan-today"');
    expect(html).not.toContain(`This week${BULLET}Aerobic base`);
  });

  it("lets today's status and session details wrap on narrow screens", () => {
    const completedPlan: CoachPlan = {
      ...plan,
      today: { ...plan.today, status: "completed", outdoor: true },
    };
    const html = renderToStaticMarkup(<CoachPlanView plan={completedPlan} />);

    expect(html).toContain('class="flex min-w-0 flex-wrap items-center gap-2"');
    expect(html).toContain(">completed<");
  });

  it("shows a rest day's status box without repeating a rest label", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="week" />,
    );

    expect(html).toContain(">rest<");
    expect(html).not.toContain(">Rest<");
  });

  it("labels today's and past partially completed sessions", () => {
    const partialPlan: CoachPlan = {
      ...plan,
      today: { ...plan.today, status: "partial" },
      week: {
        ...plan.week,
        sessions: plan.week.sessions.map((session, index) =>
          index === 0 || index === 2
            ? { ...session, status: "partial" }
            : session,
        ),
      },
    };

    const day = renderToStaticMarkup(<CoachPlanView plan={partialPlan} />);
    expect(day).toContain("partial");

    const week = renderToStaticMarkup(
      <CoachPlanView plan={partialPlan} defaultTab="week" />,
    );
    expect(week.match(/partial/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("labels a manual completion without a duration", () => {
    const manualPlan: CoachPlan = {
      ...plan,
      week: {
        ...plan.week,
        sessions: plan.week.sessions.map((session, index) =>
          index === 0
            ? {
                ...session,
                title: "Strength session",
                durationMinutes: 0,
                description: "Completed: logged manually",
              }
            : { ...session, intensity: "moderate" },
        ),
      },
    };
    const html = renderToStaticMarkup(
      <CoachPlanView plan={manualPlan} defaultTab="week" />,
    );

    expect(html).toContain("Logged manually");
    expect(html).not.toContain(`0 min${BULLET}easy`);
  });

  it("explains what skipping today's and tomorrow's sessions would cost", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView plan={plan} showTomorrow />,
    );

    expect(html.match(/Why this session matters/g)?.length).toBe(2);
    expect(html).toContain("Do not skip this session");
    expect(html).toContain(
      "This easy run builds the aerobic durability your sub-4-hour marathon needs. Skipping it would leave you underprepared for the Sunday long run and slow the base build.",
    );
    expect(html).toContain("Optional session");
    expect(html).toContain(
      "This short recovery run adds easy volume toward the marathon goal. Skipping it costs little today because the hard work this week is already done.",
    );
  });

  it("does not show skip guidance on a rest day", () => {
    const restPlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        type: "rest",
        title: "Rest",
        description: "Take the day off.",
        durationMinutes: 0,
        intensity: "rest",
        optional: true,
        optionalRationale: "Rest today supports tomorrow's session.",
      },
    };

    const html = renderToStaticMarkup(<CoachPlanView plan={restPlan} />);

    expect(html).not.toContain("Why this session matters");
    expect(html).not.toContain("Optional session");
  });

  it("shows tomorrow only when requested", () => {
    const withTomorrow = renderToStaticMarkup(
      <CoachPlanView plan={plan} showTomorrow />,
    );
    expect(withTomorrow).toContain("Tomorrow");
    expect(withTomorrow).toContain("Keep the aerobic week consistent.");

    const withoutTomorrow = renderToStaticMarkup(<CoachPlanView plan={plan} />);
    expect(withoutTomorrow).not.toContain("Tomorrow");
  });
});
