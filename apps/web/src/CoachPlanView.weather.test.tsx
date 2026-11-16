import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { BULLET, noPending, plan } from "./testFixtures/plan";

describe("CoachPlanView weather", () => {
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
    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={weatherPlan} />,
    );

    expect(html).toContain("Rain");
    expect(html).toContain(
      `Rain${BULLET}5–9 °C${BULLET}wind 4 m/s (8 m/s)${BULLET}daylight 07:45 - 16:30`,
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

    const day = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={weatherPlan} />,
    );
    const week = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={weatherPlan}
        defaultTab="week"
      />,
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
        pending={noPending}
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
    expect(flexible).toContain(`${BULLET}indoor`);

    const indoorOnly = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
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
        pending={noPending}
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
        pending={noPending}
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
        pending={noPending}
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
    expect(week).toContain(`${BULLET}indoor`);
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
      <CoachPlanView pending={noPending} plan={weekPlan} defaultTab="week" />,
    );

    expect(html).toContain("Sunny");
    expect(html).toContain(
      `Sunny${BULLET}7–14 °C${BULLET}wind 2 m/s (5 m/s)${BULLET}daylight 07:45 - 16:30`,
    );
    expect(html).toContain('class="w-full" data-testid="week-weather"');
    expect(html).toContain("stroke-amber-500");
  });
});
