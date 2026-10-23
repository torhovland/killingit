import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";

const plan: CoachPlan = {
  season: {
    goal: "Sub-4-hour marathon",
    startDate: "2026-10-21",
    endDate: "2027-04-01",
    rationale: "Build a strong aerobic base before marathon-specific work.",
    blocks: [
      {
        name: "Base",
        focus: "Aerobic endurance",
        startDate: "2026-10-21",
        endDate: "2026-12-01",
        weekCount: 6,
      },
    ],
  },
  block: {
    name: "Base",
    focus: "Aerobic endurance",
    rationale: "Establish consistent aerobic volume.",
    startDate: "2026-10-21",
    endDate: "2026-12-01",
    weeks: [
      {
        number: 1,
        startDate: "2026-10-19",
        focus: "Aerobic base",
        targetLoad: "Easy",
      },
    ],
  },
  week: {
    startDate: "2026-10-19",
    focus: "Aerobic base",
    rationale: "Keep the week easy and consistent.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(19 + index)}`,
      day: "Monday",
      type: index === 6 ? "rest" : "workout",
      title:
        index === 0
          ? "Morning Run"
          : index === 1
            ? "No activity recorded"
            : index === 2
              ? "Easy run"
              : `Session ${index + 1}`,
      description:
        index === 0
          ? "Completed: running · 10.00 km · 45 min"
          : index === 1
            ? "The athlete did not record a workout for this day."
            : "Easy aerobic work.",
      durationMinutes: index === 1 ? 0 : 45,
      intensity: index === 6 ? "rest" : "easy",
      status:
        index === 0
          ? "completed"
          : index === 1
            ? "missed"
            : index === 6
              ? "rest"
              : "planned",
    })),
  },
  today: {
    date: "2026-10-21",
    type: "workout",
    title: "Easy run",
    description: "45 minutes at conversational pace.",
    durationMinutes: 45,
    intensity: "easy",
    alternatives: ["Cross-train for 45 minutes."],
    rationale: "Easy aerobic work supports recovery.",
    optional: false,
    optionalRationale:
      "This easy run is part of a consistent aerobic week; skipping it now makes the weekend long run harder.",
    status: "planned",
  },
  tomorrow: {
    date: "2026-10-22",
    type: "workout",
    title: "Easy run",
    description: "40 minutes easy.",
    durationMinutes: 40,
    intensity: "easy",
    alternatives: [],
    rationale: "Keep the aerobic week consistent.",
    optional: true,
    optionalRationale:
      "This is a short recovery run. If your legs are tired, it is fine to skip it or replace it with a walk.",
    status: "planned",
  },
};

describe("CoachPlanView", () => {
  it("renders today's session, alternatives, and rationale", () => {
    const html = renderToStaticMarkup(<CoachPlanView plan={plan} />);

    expect(html).toContain("Today");
    expect(html).toContain("Easy run");
    expect(html).toContain("45 min");
    expect(html).toContain("Cross-train for 45 minutes.");
    expect(html).toContain("Easy aerobic work supports recovery.");
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
    expect(html).not.toContain("This week · Aerobic base");
  });

  it("renders the week, block, and season levels with rationales", () => {
    const week = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="week" />,
    );
    expect(week).toContain("This week · Aerobic base");
    expect(week).toContain("Keep the week easy and consistent.");

    const block = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="block" />,
    );
    expect(block).toContain("Block · Base");
    expect(block).toContain("Establish consistent aerobic volume.");

    const season = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="season" />,
    );
    expect(season).toContain("Season · Sub-4-hour marathon");
    expect(season).toContain(
      "Build a strong aerobic base before marathon-specific work.",
    );
  });

  it("shows completed and missed sessions for past days", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="week" />,
    );

    expect(html).toContain("Morning Run");
    expect(html).toContain("Completed: running · 10.00 km · 45 min");
    expect(html).toContain("No activity recorded");
    expect(html).toContain("missed");
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
    expect(html).not.toContain("0 min · easy");
  });

  it("explains whether today's and tomorrow's sessions should be skipped", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView plan={plan} showTomorrow />,
    );

    expect(html).toContain("Do not skip this session");
    expect(html).toContain(
      "This easy run is part of a consistent aerobic week; skipping it now makes the weekend long run harder.",
    );
    expect(html).toContain("Optional session");
    expect(html).toContain(
      "This is a short recovery run. If your legs are tired, it is fine to skip it or replace it with a walk.",
    );
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
