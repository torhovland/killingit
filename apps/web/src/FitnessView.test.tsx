import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessHistoryResponse } from "@killingit/shared";
import { FitnessView } from "./FitnessView";

function history(
  overrides: Partial<FitnessHistoryResponse> = {},
): FitnessHistoryResponse {
  return {
    days: [
      { date: "2026-10-20", tss: 0, atl: 20, ctl: 40, tsb: 20, activities: [] },
      {
        date: "2026-10-21",
        tss: 80,
        atl: 28.6,
        ctl: 41,
        tsb: 12.4,
        activities: [],
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
      },
    ],
    ftp: [
      { date: "2026-10-20", watts: 250 },
      { date: "2026-10-21", watts: 250 },
      { date: "2026-10-22", watts: 255 },
    ],
    ...overrides,
  };
}

describe("FitnessView", () => {
  it("shows today's load with its form interpretation", () => {
    const html = renderToStaticMarkup(
      <FitnessView history={history()} today="2026-10-22" />,
    );

    expect(html).toContain("Fitness");
    expect(html).toContain("TSS 60");
    expect(html).toContain("TSB +8");
    expect(html).toContain("Fresh");
  });

  it("shades the chart with the TSB zone colours and names every zone", () => {
    const html = renderToStaticMarkup(
      <FitnessView history={history()} today="2026-10-22" />,
    );

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
    const html = renderToStaticMarkup(
      <FitnessView history={history()} today="2026-10-22" />,
    );

    expect(html).toContain("stroke-form-fresh-line");
    // The zone legend comes first, then the CTL/ATL/TSB legend (whose name also
    // appears in the chart's accessible label, hence the last match).
    expect(html.indexOf("Detraining")).toBeLessThan(
      html.lastIndexOf("Fitness (CTL)"),
    );
  });

  it("plots the estimated FTP over the window", () => {
    const html = renderToStaticMarkup(
      <FitnessView history={history()} today="2026-10-22" />,
    );

    expect(html).toContain('data-testid="ftp-chart"');
    expect(html).toContain("Estimated FTP");
    expect(html).toContain("255 W");
  });

  it("hides the FTP chart when the athlete has no FTP", () => {
    const html = renderToStaticMarkup(
      <FitnessView history={history({ ftp: [] })} today="2026-10-22" />,
    );

    expect(html).not.toContain('data-testid="ftp-chart"');
  });

  it("asks for training history when there is nothing to chart yet", () => {
    const html = renderToStaticMarkup(
      <FitnessView history={history({ days: [] })} today="2026-10-22" />,
    );

    expect(html).toContain("Not enough history yet");
    expect(html).not.toContain('data-testid="fitness-chart"');
  });

  it("shows loading and error states", () => {
    const loading = renderToStaticMarkup(
      <FitnessView history={null} today="2026-10-22" />,
    );
    expect(loading).toContain("Loading…");

    const failed = renderToStaticMarkup(
      <FitnessView history={null} today="2026-10-22" error="Network down" />,
    );
    expect(failed).toContain("Error: Network down");
  });
});
