import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessHistoryDay, FtpHistoryPoint } from "@killingit/shared";
import { FitnessChart } from "./FitnessChart";
import { FtpChart } from "./FtpChart";

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

const points: FtpHistoryPoint[] = days.map((entry, index) => ({
  date: entry.date,
  watts: 250 + index,
}));

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

describe("FtpChart", () => {
  it("draws the projected FTP as dotted steps", () => {
    const html = renderToStaticMarkup(
      <FtpChart days={days} points={points} today="2026-10-22" />,
    );

    expect(html).toContain('data-series="ftp" data-future="true"');
  });
});
