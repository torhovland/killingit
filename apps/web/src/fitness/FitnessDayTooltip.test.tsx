import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FitnessHistoryDay } from "@killingit/shared";
import { FitnessDayTooltip } from "./FitnessDayTooltip";

function day(overrides: Partial<FitnessHistoryDay> = {}): FitnessHistoryDay {
  return {
    date: "2026-10-22",
    tss: 95,
    atl: 33.1,
    ctl: 41.5,
    tsb: 8.4,
    activities: [],
    planned: null,
    ...overrides,
  };
}

describe("FitnessDayTooltip", () => {
  it("shows the day's load and its interpretation", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip day={day()} today="2026-10-22" />,
    );

    expect(html).toContain("22 Oct");
    expect(html).toContain("TSS 95");
    expect(html).toContain("TSB +8");
    expect(html).toContain("Fresh");
  });

  it("lists the activities logged that day", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        today="2026-10-22"
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

  it("names the planned workout when nothing was logged", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        today="2026-10-22"
        day={day({
          planned: {
            title: "Endurance ride",
            type: "workout",
            durationMinutes: 90,
          },
        })}
      />,
    );

    expect(html).toContain("Planned:");
    expect(html).toContain("Endurance ride");
    expect(html).toContain("90 min");
    expect(html).not.toContain("No activities recorded");
  });

  it("says Rest on a rest day that has arrived", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        today="2026-10-22"
        day={day({
          planned: { title: "Rest day", type: "rest", durationMinutes: 0 },
        })}
      />,
    );

    expect(html).toContain("Rest");
    expect(html).not.toContain("Planned:");
    expect(html).not.toContain("No activities recorded");
  });

  it("says Planned: Rest for a rest day still ahead", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        today="2026-10-22"
        day={day({
          date: "2026-10-25",
          planned: { title: "Rest day", type: "rest", durationMinutes: 0 },
        })}
      />,
    );

    expect(html).toContain("Planned:");
    expect(html).toContain("Rest");
    expect(html).not.toContain("0 min");
  });

  it("prefers what was logged over the plan", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        today="2026-10-22"
        day={day({
          activities: [
            { id: "activity-1", name: "Morning ride", type: "cycling" },
          ],
          planned: {
            title: "Endurance ride",
            type: "workout",
            durationMinutes: 90,
          },
        })}
      />,
    );

    expect(html).toContain("Morning ride");
    expect(html).not.toContain("Planned:");
  });

  it("says so when nothing was logged and nothing is planned", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip day={day()} today="2026-10-22" />,
    );

    expect(html).toContain("No activities recorded");
  });

  it("reads activity durations in minutes under an hour and hours above it", () => {
    const html = renderToStaticMarkup(
      <FitnessDayTooltip
        today="2026-10-22"
        day={day({
          activities: [
            {
              id: "activity-1",
              name: "Easy spin",
              type: "cycling",
              durationMinutes: 45,
            },
            {
              id: "activity-2",
              name: "Long ride",
              type: "cycling",
              durationMinutes: 60,
            },
            {
              id: "activity-3",
              name: "Endurance ride",
              type: "cycling",
              durationMinutes: 80,
            },
          ],
        })}
      />,
    );

    expect(html).toContain("45 min");
    expect(html).toContain("1 h</span>");
    expect(html).toContain("1 h 20");
  });
});
