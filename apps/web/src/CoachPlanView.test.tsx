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
      "This easy run builds the aerobic durability your sub-4-hour marathon needs. Skipping it would leave you underprepared for the Sunday long run and slow the base build.",
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
      "This short recovery run adds easy volume toward the marathon goal. Skipping it costs little today because the hard work this week is already done.",
    status: "planned",
  },
  nextWeek: null,
  nextBlock: null,
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
    expect(block).toContain("Current block · Base");
    expect(block).toContain("Establish consistent aerobic volume.");

    const season = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="season" />,
    );
    expect(season).toContain("Season · Sub-4-hour marathon");
    expect(season).toContain(
      "Build a strong aerobic base before marathon-specific work.",
    );
  });

  it("renders the next week and next block after 18:00", () => {
    const nextDates = [
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ];
    const nextPlan: CoachPlan = {
      ...plan,
      nextWeek: {
        ...plan.week,
        startDate: "2026-10-26",
        focus: "Aerobic build",
        rationale: "Start the next week with an easy aerobic block.",
        sessions: plan.week.sessions.map((session, index) => ({
          ...session,
          date: nextDates[index] ?? session.date,
          title: `Next session ${index + 1}`,
        })),
      },
      nextBlock: {
        ...plan.block,
        name: "Build",
        focus: "Threshold work",
        rationale: "Add threshold work after the aerobic base.",
        startDate: "2026-12-02",
        endDate: "2027-01-15",
      },
    };

    const week = renderToStaticMarkup(
      <CoachPlanView plan={nextPlan} defaultTab="week" />,
    );
    expect(week).toContain("This week · Aerobic base");
    expect(week).toContain("Next week · Aerobic build");
    expect(week).toContain("Week starting Mon, Oct 26");
    expect(week).toContain("Next session 1");
    expect(week).toContain('data-testid="plan-next-week"');

    const block = renderToStaticMarkup(
      <CoachPlanView plan={nextPlan} defaultTab="block" />,
    );
    expect(block).toContain("Current block · Base");
    expect(block).toContain("Next block · Build");
    expect(block).toContain("Add threshold work after the aerobic base.");
    expect(block).toContain('data-testid="plan-next-block"');
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

  it("shows the forecast on an outdoor workout", () => {
    const weather = {
      date: "2026-10-21",
      icon: "rain" as const,
      temperatureMaxC: 9.4,
      temperatureMinC: 5.2,
      windMaxMs: 4.3,
      gustMaxMs: 8.1,
      precipitationMm: 2,
      sunrise: "07:45",
      sunset: "16:30",
    };
    const weatherPlan = {
      ...plan,
      today: { ...plan.today, outdoor: true, weather },
    };
    const html = renderToStaticMarkup(<CoachPlanView plan={weatherPlan} />);

    expect(html).toContain("Rain");
    expect(html).toContain("5–9 °C");
    expect(html).toContain("wind 4 m/s");
    expect(html).toContain("gusts 8 m/s");
    expect(html).toContain("sunrise 07:45");
    expect(html).toContain("sunset 16:30");
    expect(html).toContain('aria-label="Rain"');
    expect(html).toContain('data-testid="weather"');
    expect(html).toContain("stroke-sky-500");
    expect(html).toContain("stroke-slate-400");
  });

  it("hides the forecast for indoor sessions and rest days", () => {
    const weather = {
      date: "2026-10-21",
      icon: "snow" as const,
      temperatureMaxC: 0,
      temperatureMinC: -4,
      windMaxMs: 3,
      gustMaxMs: 6,
      precipitationMm: 1,
    };
    const indoor = renderToStaticMarkup(
      <CoachPlanView
        plan={{ ...plan, today: { ...plan.today, outdoor: false, weather } }}
      />,
    );
    expect(indoor).not.toContain("Snow");

    const rest = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: { ...plan.today, type: "rest", weather },
        }}
      />,
    );
    expect(rest).not.toContain("Snow");
  });

  it("shows weather for an outdoor session in the week view", () => {
    const weather = {
      date: "2026-10-22",
      icon: "sun" as const,
      temperatureMaxC: 14,
      temperatureMinC: 7,
      windMaxMs: 2,
      gustMaxMs: 5,
      precipitationMm: 0,
      sunrise: "07:45",
      sunset: "16:30",
    };
    const weekPlan = {
      ...plan,
      week: {
        ...plan.week,
        sessions: plan.week.sessions.map((session) =>
          session.date === "2026-10-22"
            ? { ...session, outdoor: true, weather }
            : session,
        ),
      },
    };
    const html = renderToStaticMarkup(
      <CoachPlanView plan={weekPlan} defaultTab="week" />,
    );

    expect(html).toContain("Sunny");
    expect(html).toContain("7–14 °C");
    expect(html).toContain("sunrise 07:45");
    expect(html).toContain("sunset 16:30");
    expect(html).toContain('class="w-full" data-testid="week-weather"');
    expect(html).toContain("stroke-amber-500");
  });
});
