import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  FitnessHistoryDay,
  ThresholdHistorySeries,
} from "@killingit/shared";
import { FitnessChart } from "./FitnessChart";
import { ThresholdChart } from "./ThresholdChart";

function day(date: string, overrides: Partial<FitnessHistoryDay> = {}) {
  return {
    date,
    tss: 60,
    atl: 30,
    ctl: 40,
    tsb: 10,
    activities: [],
    planned: null,
    ...overrides,
  } satisfies FitnessHistoryDay;
}

const days = [
  day("2026-10-20"),
  day("2026-10-21"),
  day("2026-10-22"),
  day("2026-10-23"),
  day("2026-10-24"),
];

const thresholdSeries: ThresholdHistorySeries[] = [
  {
    sport: "cycling",
    measure: "ftp",
    label: "FTP",
    unit: "W",
    kind: "power",
    points: days.map((entry, index) => ({
      date: entry.date,
      value: 250 + index,
    })),
  },
  {
    sport: "cycling",
    measure: "threshold_heart_rate",
    label: "Threshold heart rate",
    unit: "bpm",
    kind: "heart_rate",
    points: days.map((entry, index) => ({
      date: entry.date,
      value: 160 + index,
    })),
  },
];

describe("FitnessChart", () => {
  it("draws the days after today as the plan's projection", () => {
    const html = renderToStaticMarkup(
      <FitnessChart days={days} today="2026-10-22" />,
    );

    expect(html).toContain('data-series="ctl" data-future="true"');
    expect(html).toContain('data-series="atl" data-future="true"');
    expect(html).toContain('stroke-dasharray="2 3"');
  });

  it("leaves every line solid when today is the last day", () => {
    const html = renderToStaticMarkup(
      <FitnessChart days={days.slice(0, 3)} today="2026-10-22" />,
    );

    expect(html).not.toContain('data-future="true"');
  });
});

describe("ThresholdChart", () => {
  it("draws one line per threshold measure", () => {
    const html = renderToStaticMarkup(
      <ThresholdChart
        days={days}
        series={thresholdSeries}
        today="2026-10-22"
      />,
    );

    expect(html).toContain("Estimated threshold");
    expect(html).toContain('data-series="cycling:ftp"');
    expect(html).toContain('data-series="cycling:threshold_heart_rate"');
    expect(html).toContain('data-series="cycling:ftp" data-future="true"');
  });

  it("puts one panel per unit below the heading", () => {
    const html = renderToStaticMarkup(
      <ThresholdChart
        days={days}
        series={thresholdSeries}
        today="2026-10-22"
      />,
    );

    expect(html.match(/data-testid="threshold-panel"/g)).toHaveLength(2);
    expect(html).toContain('data-unit="W"');
    expect(html).toContain('data-unit="bpm"');
    // The heading is outside the panels, not a caption inside one of them.
    expect(html.indexOf("Estimated threshold")).toBeLessThan(
      html.indexOf('data-testid="threshold-panel"'),
    );
  });

  it("keeps the unit in the legend instead of on the y axis", () => {
    const html = renderToStaticMarkup(
      <ThresholdChart
        days={days}
        series={thresholdSeries}
        today="2026-10-22"
      />,
    );

    // Axis labels are plain numbers; the legend names the unit.
    expect(html).not.toMatch(/>\d+ (W|bpm)</);
    expect(html).toContain("FTP");
    expect(html).toContain("cycling · W");
    expect(html).toContain("Threshold heart rate");
    expect(html).toContain("cycling · bpm");
  });

  it("reads a pace axis as minutes and seconds without the unit", () => {
    const html = renderToStaticMarkup(
      <ThresholdChart
        days={days}
        series={[
          {
            sport: "running",
            measure: "threshold_pace",
            label: "Threshold pace",
            unit: "s/km",
            kind: "pace",
            points: days.map((entry, index) => ({
              date: entry.date,
              value: 270 + index,
            })),
          },
        ]}
        today="2026-10-22"
      />,
    );

    expect(html).toMatch(/>\d+:\d\d</);
    expect(html).not.toContain(" /km</text>");
    expect(html).toContain("running · s/km");
  });
});
