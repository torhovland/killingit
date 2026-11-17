import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThresholdSummary } from "@killingit/shared";
import { CoachPlanView } from "./CoachPlanView";
import { BULLET, noPending, plan } from "../testFixtures/plan";

describe("CoachPlanView thresholds", () => {
  it("shows every known threshold in place of the single FTP estimate", () => {
    const thresholds: ThresholdSummary[] = [
      {
        sport: "cycling",
        measure: "ftp",
        label: "FTP",
        unit: "W",
        kind: "power",
        source: "user",
        date: "2026-10-20",
        value: 250,
      },
      {
        sport: "running",
        measure: "threshold_pace",
        label: "Threshold pace",
        unit: "s/km",
        kind: "pace",
        source: "user",
        date: "2026-10-20",
        value: 270,
      },
    ];

    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={plan}
        defaultTab="week"
        thresholds={thresholds}
      />,
    );

    expect(html).toContain('data-testid="week-thresholds"');
    expect(html).toContain("cycling FTP");
    expect(html).toContain("250 W");
    expect(html).toContain("running Threshold pace");
    expect(html).toContain("4:30 /km");
    expect(html).not.toContain('data-testid="week-ftp"');
  });

  it("shows only the thresholds for the day's sport", () => {
    const thresholds: ThresholdSummary[] = [
      {
        sport: "cycling",
        measure: "ftp",
        label: "FTP",
        unit: "W",
        kind: "power",
        source: "user",
        date: "2026-10-20",
        value: 250,
      },
      {
        sport: "running",
        measure: "threshold_pace",
        label: "Threshold pace",
        unit: "s/km",
        kind: "pace",
        source: "user",
        date: "2026-10-20",
        value: 270,
      },
    ];

    const html = renderToStaticMarkup(
      <CoachPlanView pending={noPending} plan={plan} thresholds={thresholds} />,
    );

    expect(html).toContain('data-testid="plan-today-thresholds"');
    expect(html).toContain("running Threshold pace");
    expect(html).not.toContain("cycling FTP");
  });

  it("shows no thresholds on a rest day", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={{
          ...plan,
          today: {
            ...plan.today,
            type: "rest",
            intensity: "rest",
            title: "Rest and hip mobility",
          },
        }}
        thresholds={[
          {
            sport: "running",
            measure: "threshold_pace",
            label: "Threshold pace",
            unit: "s/km",
            kind: "pace",
            source: "user",
            date: "2026-10-20",
            value: 270,
          },
        ]}
      />,
    );

    expect(html).not.toContain('data-testid="plan-today-thresholds"');
  });

  it("uses a bullet after the Thresholds label instead of a colon", () => {
    const html = renderToStaticMarkup(
      <CoachPlanView
        pending={noPending}
        plan={plan}
        thresholds={[
          {
            sport: "running",
            measure: "threshold_pace",
            label: "Threshold pace",
            unit: "s/km",
            kind: "pace",
            source: "user",
            date: "2026-10-20",
            value: 270,
          },
        ]}
      />,
    );

    expect(html).not.toContain("Thresholds:");
    expect(html).toContain(
      `<span data-testid="plan-today-thresholds"><span class="font-medium">Thresholds</span><span>${BULLET}running Threshold pace`,
    );
  });
});
