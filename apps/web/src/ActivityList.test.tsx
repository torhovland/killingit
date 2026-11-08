import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyzedActivity } from "@killingit/shared";
import { ActivityList } from "./ActivityList";
import { TimeZoneProvider } from "./TimeZoneContext";

const activity: AnalyzedActivity = {
  id: 1,
  name: "Morning Run",
  type: "running",
  startDate: "2026-10-01T06:30:00Z",
  distance: 5000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
  sampleCount: 0,
  samples: [],
  analysis: null,
  analysisError: null,
  programAnalysis: null,
  comment: null,
  coachReply: null,
};

function render(activities: AnalyzedActivity[], emptyMessage?: string): string {
  return renderToStaticMarkup(
    <TimeZoneProvider timeZone="Europe/Oslo">
      <ActivityList
        activities={activities}
        {...(emptyMessage === undefined ? {} : { emptyMessage })}
      />
    </TimeZoneProvider>,
  );
}

describe("ActivityList", () => {
  it("renders one card per activity", () => {
    const html = render([
      activity,
      { ...activity, id: 2, name: "Evening Ride", type: "cycling" },
    ]);

    expect(html).toContain("Morning Run");
    expect(html).toContain("Evening Ride");
  });

  it("renders the empty message when the feed has no activities", () => {
    const html = render([], "No synced activities yet.");

    expect(html).toContain("No synced activities yet.");
  });

  it("renders nothing when empty with no message", () => {
    expect(render([])).toBe("");
  });
});
