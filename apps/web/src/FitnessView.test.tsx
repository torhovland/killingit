import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessHistoryResponse } from "@killingit/shared";
import { FitnessView } from "./FitnessView";

function history(
  overrides: Partial<FitnessHistoryResponse> = {},
): FitnessHistoryResponse {
  return {
    days: [
      {
        date: "2026-10-20",
        tss: 0,
        atl: 20,
        ctl: 40,
        tsb: 20,
        activities: [],
        planned: null,
      },
      {
        date: "2026-10-21",
        tss: 80,
        atl: 28.6,
        ctl: 41,
        tsb: 12.4,
        activities: [],
        planned: {
          title: "Endurance ride",
          type: "workout",
          durationMinutes: 90,
        },
      },
      {
        date: "2026-10-22",
        tss: 60,
        atl: 33.1,
        ctl: 41.5,
        tsb: 8.4,
        activities: [
          {
            id: "activity-1",
            name: "Morning ride",
            type: "cycling",
            durationMinutes: 60,
          },
        ],
        planned: null,
      },
    ],
    ftp: [
      { date: "2026-10-20", watts: 250 },
      { date: "2026-10-21", watts: 250 },
      { date: "2026-10-22", watts: 255 },
    ],
    body: {
      weight: [
        { date: "2026-10-20", value: 78.2 },
        { date: "2026-10-21", value: 78.1 },
        { date: "2026-10-22", value: 78.0 },
      ],
      bodyFat: [{ date: "2026-10-20", value: 18.4 }],
    },
    ...overrides,
  };
}

function view(
  overrides: Partial<Parameters<typeof FitnessView>[0]> = {},
): string {
  return renderToStaticMarkup(
    <FitnessView
      history={history()}
      today="2026-10-22"
      range="month"
      onRangeChange={() => undefined}
      {...overrides}
    />,
  );
}

describe("FitnessView", () => {
  it("shows today's load with its form interpretation", () => {
    const html = view();

    expect(html).toContain("Fitness");
    // The summary spells each metric out and keeps the acronym beside it.
    expect(html).toContain("Training stress 60");
    expect(html).toContain("Fatigue 33");
    expect(html).toContain("Fitness 42");
    expect(html).toContain("Form +8");
    for (const acronym of ["TSS", "ATL", "CTL", "TSB"]) {
      expect(html).toContain(`(${acronym})`);
    }
    expect(html).toContain("Fresh");
  });

  it("offers every range in the picker above the charts", () => {
    const html = view();
    const picker = html.slice(
      html.indexOf("<select"),
      html.indexOf('data-testid="fitness-chart"'),
    );

    for (const label of ["Week", "Month", "Quarter", "Year", "All time"]) {
      expect(picker).toContain(`>${label}</option>`);
    }
    expect(picker).toContain('value="month" selected');
  });

  it("shades the chart with the TSB zone colours and names every zone", () => {
    const html = view();

    expect(html).toContain('data-testid="fitness-chart"');
    for (const zone of [
      "risk",
      "productive",
      "maintaining",
      "fresh",
      "detraining",
    ]) {
      expect(html).toContain(`data-testid="form-zone-${zone}"`);
    }
    expect(html).toContain("fill-form-productive/[62.5%]");
    expect(html).toContain("Productive");
    expect(html).toContain("above +25");
  });

  it("draws the TSB line in the zone colours and lists the zones first", () => {
    const html = view();

    expect(html).toContain("stroke-form-fresh-line");
    // The zone legend comes first, then the CTL/ATL/TSB legend (whose name also
    // appears in the chart's accessible label, hence the last match).
    expect(html.indexOf("Detraining")).toBeLessThan(
      html.lastIndexOf("Fitness (CTL)"),
    );
  });

  it("shows today's estimated FTP in the Today panel", () => {
    const html = view();

    const todayPanel = html.slice(
      html.indexOf('data-testid="fitness-today-load"'),
      html.indexOf('data-testid="fitness-chart"'),
    );
    expect(todayPanel).toContain("Estimated FTP 255 W");
    expect(html).toContain('data-testid="ftp-chart"');
  });

  it("shows body weight and body fat when the athlete has measurements", () => {
    const html = view();

    expect(html).toContain('data-testid="body-chart"');
    expect(html).toContain("Weight (kg)");
    expect(html).toContain("Body fat (%)");
    expect(html).toContain('data-series="weight"');
    expect(html).toContain('data-series="body-fat"');
  });

  it("hides the body chart without any measurements", () => {
    const html = view({
      history: history({ body: { weight: [], bodyFat: [] } }),
    });

    expect(html).not.toContain('data-testid="body-chart"');
  });

  it("shows only weight when there is no body-fat data", () => {
    const html = view({
      history: history({
        body: {
          weight: [{ date: "2026-10-20", value: 78.2 }],
          bodyFat: [],
        },
      }),
    });

    expect(html).toContain('data-testid="body-chart"');
    expect(html).toContain("Weight (kg)");
    expect(html).not.toContain("Body fat (%)");
  });

  it("hides the FTP chart and the estimate when the athlete has no FTP", () => {
    const html = view({ history: history({ ftp: [] }) });

    expect(html).not.toContain('data-testid="ftp-chart"');
    expect(html).not.toContain("Estimated FTP");
  });

  it("asks for training history when there is nothing to chart yet", () => {
    const html = view({ history: history({ days: [] }) });

    expect(html).toContain("Not enough history yet");
    expect(html).not.toContain('data-testid="fitness-chart"');
  });

  it("shows loading, updating, and error states", () => {
    expect(view({ history: null })).toContain("Loading…");
    expect(view({ loading: true })).toContain("Updating…");
    expect(view({ history: null, error: "Network down" })).toContain(
      "Error: Network down",
    );
  });
});
