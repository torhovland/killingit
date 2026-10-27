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

  it("lists block weeks like season blocks, with muted details and rules", () => {
    const block = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="block" />,
    );
    expect(block).toContain("Week 1");
    expect(block).toContain("Week starting Mon, Oct 19");
    expect(block).toContain("Target load: Easy");
    expect(block).toContain("Aerobic base");
    expect(block).toContain("border-b");

    const season = renderToStaticMarkup(
      <CoachPlanView plan={plan} defaultTab="season" />,
    );
    expect(season).toContain("1. Base");
    expect(season).toContain("6 weeks");
    expect(season).toContain("Aerobic endurance");
    expect(season).toContain("border-b");
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
    expect(html).toContain(
      "Rain · 5–9 °C · wind 4 m/s (8 m/s) · daylight 07:45 - 16:30",
    );
    expect(html).toContain('aria-label="Rain"');
    expect(html).toContain('data-testid="weather"');
    expect(html).toContain("stroke-sky-500");
    expect(html).toContain("stroke-slate-400");
  });

  it("shows each provider forecast in the day and week views", () => {
    const openMeteo = {
      date: "2026-10-21",
      icon: "sun" as const,
      temperatureMaxC: 12,
      temperatureMinC: 6,
      windMaxMs: 3,
      gustMaxMs: 7,
      precipitationMm: 0,
      sunrise: "07:45",
      sunset: "16:30",
    };
    const yr = {
      ...openMeteo,
      icon: "rain" as const,
      temperatureMaxC: 14,
      temperatureMinC: 8,
    };
    const combined = {
      ...openMeteo,
      icon: "rain" as const,
      temperatureMaxC: 13,
      temperatureMinC: 7,
    };
    const forecasts = { openMeteo, yr, combined };
    const weatherPlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        outdoor: true,
        weather: combined,
        forecasts,
      },
      week: {
        ...plan.week,
        sessions: plan.week.sessions.map((session) =>
          session.date === "2026-10-21"
            ? { ...session, outdoor: true, weather: combined, forecasts }
            : session,
        ),
      },
    };

    const day = renderToStaticMarkup(<CoachPlanView plan={weatherPlan} />);
    const week = renderToStaticMarkup(
      <CoachPlanView plan={weatherPlan} defaultTab="week" />,
    );

    for (const html of [day, week]) {
      expect(html).toContain("Open-Meteo");
      expect(html).toContain("Yr.no");
      expect(html).toContain("Combined");
    }
  });

  it("shows the forecast for flexible sessions and hides it for indoor-only sessions and rest days", () => {
    const weather = {
      date: "2026-10-21",
      icon: "snow" as const,
      temperatureMaxC: 0,
      temperatureMinC: -4,
      windMaxMs: 3,
      gustMaxMs: 6,
      precipitationMm: 1,
    };
    const flexible = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: {
            ...plan.today,
            outdoor: false,
            canBeOutdoor: true,
            weather,
          },
        }}
      />,
    );
    expect(flexible).toContain("Snow");
    expect(flexible).toContain("· indoor");

    const indoorOnly = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: {
            ...plan.today,
            outdoor: false,
            canBeOutdoor: false,
            weather,
          },
        }}
      />,
    );
    expect(indoorOnly).not.toContain("Snow");

    const indoorWeek = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          week: {
            ...plan.week,
            sessions: plan.week.sessions.map((session) =>
              session.date === "2026-10-21"
                ? {
                    ...session,
                    outdoor: false,
                    canBeOutdoor: false,
                    weather,
                  }
                : session,
            ),
          },
        }}
        defaultTab="week"
      />,
    );
    expect(indoorWeek).not.toContain("Snow");

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

  it("shows the coach's session details and indoor/outdoor intent in the week view", () => {
    const week = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          week: {
            ...plan.week,
            sessions: plan.week.sessions.map((session) =>
              session.date === "2026-10-21"
                ? {
                    ...session,
                    description: "Easy trainer ride with cadence blocks.",
                    outdoor: false,
                    canBeOutdoor: true,
                  }
                : session,
            ),
          },
        }}
        defaultTab="week"
      />,
    );

    expect(week).toContain("Easy trainer ride with cadence blocks.");
    expect(week).toContain("· indoor");
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
    expect(html).toContain(
      "Sunny · 7–14 °C · wind 2 m/s (5 m/s) · daylight 07:45 - 16:30",
    );
    expect(html).toContain('class="w-full" data-testid="week-weather"');
    expect(html).toContain("stroke-amber-500");
  });

  it("offers a workout-file download for indoor bike power sessions", () => {
    const bikeWorkout = {
      ftpWatts: 250,
      intervals: [
        { durationSeconds: 600, powerPercent: 55 },
        { durationSeconds: 480, powerPercent: 90 },
      ],
    };
    const bikePlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        title: "Sweet spot",
        outdoor: false,
        canBeOutdoor: false,
        bikeWorkout,
      },
      tomorrow: {
        ...(plan.tomorrow ?? plan.today),
        title: "Tempo blocks",
        outdoor: false,
        canBeOutdoor: false,
        bikeWorkout,
      },
    };

    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={bikePlan}
        showTomorrow
        onDownloadWorkout={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="plan-today-download"');
    expect(html).toContain('data-testid="plan-tomorrow-download"');
    expect(html).toContain('data-testid="plan-today-ftp"');
    expect(html).toContain('data-testid="plan-tomorrow-ftp"');
    expect(html).toContain("Estimated FTP:");
    expect(html).toContain("250 W");
    expect(html).toContain("Set this FTP in Zwift or another trainer app");
    expect(html).toContain("Download workout file (.zwo)");
    expect(html).toContain("For Zwift or another trainer app.");
  });

  it("shows no estimated FTP when the session has no structured power targets", () => {
    const html = renderToStaticMarkup(<CoachPlanView plan={plan} />);

    expect(html).not.toContain('data-testid="plan-today-ftp"');
    expect(html).not.toContain("Estimated FTP:");
  });

  it("hides the download when the session is not an indoor power workout", () => {
    const bikeWorkout = {
      ftpWatts: 250,
      intervals: [{ durationSeconds: 600, powerPercent: 55 }],
    };
    const outdoor = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: { ...plan.today, outdoor: true, bikeWorkout },
        }}
        onDownloadWorkout={() => undefined}
      />,
    );
    expect(outdoor).not.toContain('data-testid="plan-today-download"');
    // The estimated FTP still helps even when this instance is ridden outside.
    expect(outdoor).toContain('data-testid="plan-today-ftp"');

    const noTargets = renderToStaticMarkup(
      <CoachPlanView
        plan={{ ...plan, today: { ...plan.today, outdoor: false } }}
        onDownloadWorkout={() => undefined}
      />,
    );
    expect(noTargets).not.toContain('data-testid="plan-today-download"');

    const withoutHandler = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: { ...plan.today, outdoor: false, bikeWorkout },
        }}
      />,
    );
    expect(withoutHandler).not.toContain('data-testid="plan-today-download"');
  });

  it("shows the week's estimated FTP and training load", () => {
    const load: { tss: number; atl: number; ctl: number; tsb: number } = {
      tss: 64,
      atl: 9.1,
      ctl: 1.5,
      tsb: -7.6,
    };
    const loadedPlan: CoachPlan = {
      ...plan,
      week: {
        ...plan.week,
        estimatedFtpWatts: 250,
        sessions: plan.week.sessions.map((session) =>
          session.date === "2026-10-21"
            ? { ...session, trainingLoad: load }
            : session,
        ),
      },
    };

    const html = renderToStaticMarkup(
      <CoachPlanView plan={loadedPlan} defaultTab="week" />,
    );

    expect(html).toContain('data-testid="week-ftp"');
    expect(html).toContain("Estimated FTP:");
    expect(html).toContain("250 W");
    expect(html).toContain('data-testid="session-load"');
    expect(html).toContain("TSS 64");
    expect(html).toContain("ATL 9");
    expect(html).toContain("CTL 2");
    expect(html).toContain("TSB -8");
    expect(html).toContain("Productive");
  });

  it("labels the TSB interpretation with its colour", () => {
    const loadedPlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        trainingLoad: { tss: 20, atl: 18, ctl: 30, tsb: 12 },
      },
    };

    const html = renderToStaticMarkup(<CoachPlanView plan={loadedPlan} />);

    expect(html).toContain("TSS 20");
    expect(html).toContain("TSB +12");
    expect(html).toContain("Unproductive");
    expect(html).toContain("text-form-unproductive");
  });

  it("marks a very high fatigue balance as risk", () => {
    const loadedPlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        trainingLoad: { tss: 120, atl: 70, ctl: 40, tsb: -30 },
      },
    };

    const html = renderToStaticMarkup(<CoachPlanView plan={loadedPlan} />);

    expect(html).toContain("TSB -30");
    expect(html).toContain("Risk");
    expect(html).toContain("text-form-risk");
  });

  it("shows estimated FTP on the block and season tabs", () => {
    const withFtp: CoachPlan = {
      ...plan,
      block: { ...plan.block, estimatedFtpWatts: 250 },
      season: { ...plan.season, estimatedFtpWatts: 250 },
    };

    const block = renderToStaticMarkup(
      <CoachPlanView plan={withFtp} defaultTab="block" />,
    );
    expect(block).toContain('data-testid="block-ftp"');
    expect(block).toContain("250 W");

    const season = renderToStaticMarkup(
      <CoachPlanView plan={withFtp} defaultTab="season" />,
    );
    expect(season).toContain('data-testid="season-ftp"');
    expect(season).toContain("250 W");
  });

  it("shows the training load in the today and tomorrow cards", () => {
    const load: { tss: number; atl: number; ctl: number; tsb: number } = {
      tss: 64,
      atl: 9.1,
      ctl: 1.5,
      tsb: -7.6,
    };
    const loadedPlan: CoachPlan = {
      ...plan,
      today: { ...plan.today, trainingLoad: load },
      tomorrow: { ...(plan.tomorrow ?? plan.today), trainingLoad: load },
    };

    const html = renderToStaticMarkup(
      <CoachPlanView plan={loadedPlan} showTomorrow />,
    );

    expect(html).toContain('data-testid="plan-today-load"');
    expect(html).toContain('data-testid="plan-tomorrow-load"');
    expect(html).toContain("TSS 64");
  });

  it("disables the download button while the file is prepared", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        plan={{
          ...plan,
          today: {
            ...plan.today,
            outdoor: false,
            bikeWorkout: {
              ftpWatts: 250,
              intervals: [{ durationSeconds: 600, powerPercent: 55 }],
            },
          },
        }}
        onDownloadWorkout={() => undefined}
        downloadingWorkoutDate={plan.today.date}
      />,
    );

    expect(html).toContain("Preparing workout file…");
    expect(html).toContain("disabled");
  });
});
