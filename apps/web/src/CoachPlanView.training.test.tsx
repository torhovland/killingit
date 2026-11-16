import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachPlan } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { noPending, plan } from "./testFixtures/plan";

describe("CoachPlanView training metrics", () => {
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
      <CoachPlanView pending={noPending} plan={loadedPlan} defaultTab="week" />,
    );

    expect(html).toContain('data-testid="week-ftp"');
    expect(html).toContain("Estimated FTP:");
    expect(html).toContain("250 W");
    expect(html).toContain('data-testid="session-load"');
    expect(html).toContain("TSS 64");
    expect(html).toContain("ATL 9");
    expect(html).toContain("CTL 2");
    expect(html).toContain("TSB -8");
    expect(html).toContain("Maintaining");
  });

  it("labels the TSB interpretation with its colour", () => {
    const loadedPlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        trainingLoad: { tss: 20, atl: 20, ctl: 20, tsb: 0 },
      },
    };

    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={loadedPlan} />,
    );

    expect(html).toContain("TSS 20");
    expect(html).toContain("TSB 0");
    expect(html).toContain("Maintaining");
    expect(html).toContain("text-form-maintaining");
  });

  it("marks a very high fatigue balance as risk", () => {
    const loadedPlan: CoachPlan = {
      ...plan,
      today: {
        ...plan.today,
        trainingLoad: { tss: 120, atl: 75, ctl: 40, tsb: -35 },
      },
    };

    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={loadedPlan} />,
    );

    expect(html).toContain("TSB -35");
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
      <CoachPlanView pending={noPending} plan={withFtp} defaultTab="block" />,
    );
    expect(block).toContain('data-testid="block-ftp"');
    expect(block).toContain("250 W");

    const season = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={withFtp} defaultTab="season" />,
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
      <CoachPlanView pending={noPending} plan={loadedPlan} showTomorrow />,
    );

    expect(html).toContain('data-testid="plan-today-load"');
    expect(html).toContain('data-testid="plan-tomorrow-load"');
    expect(html).toContain("TSS 64");
  });
});
