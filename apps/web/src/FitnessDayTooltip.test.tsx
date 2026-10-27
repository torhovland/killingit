import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessHistoryDay } from "@killingit/shared";
import { FitnessDayTooltip, formatDuration } from "./FitnessDayTooltip";

function day(overrides: Partial<FitnessHistoryDay> = {}): FitnessHistoryDay {
  return {
    date: "2026-10-22",
    tss: 95,
    atl: 33.1,
    ctl: 41.5,
    tsb: 8.4,
    activities: [],
    ...overrides,
  };
}

describe("FitnessDayTooltip", () => {
  it("shows the day's load and its interpretation", () => {
    const html = renderToStaticMarkup(<FitnessDayTooltip day={day()} />);

    expect(html).toContain("22 Oct");
    expect(html).toContain("TSS 95");
    expect(html).toContain("TSB +8");
    expect(html).toContain("Fresh");
  });

  it("lists the activities logged that day", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        day={day({
          activities: [
            {
              id: "activity-1",
              name: "Morning ride",
              type: "indoor_cycling",
              durationMinutes: 80,
            },
            {
              id: "manual-2",
              name: "Strength session at the gym",
              type: "manual",
            },
          ],
        })}
      />,
    );

    expect(html).toContain("Morning ride");
    expect(html).toContain("Indoor cycling");
    expect(html).toContain("1 h 20");
    expect(html).toContain("Strength session at the gym");
    expect(html).toContain("Manual");
  });

  it("says so when nothing was logged", () => {
    const html = renderToStaticMarkup(<FitnessDayTooltip day={day()} />);

    expect(html).toContain("No activities recorded");
  });
});

describe("formatDuration", () => {
  it("reads as minutes under an hour and hours above it", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(80)).toBe("1 h 20");
  });
});
