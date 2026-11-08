import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalyzedActivity } from "@killingit/shared";
import { PendingActivitiesSection } from "./PendingActivitiesSection";
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

function render(activities: AnalyzedActivity[]): string {
  return renderToStaticMarkup(
    <TimeZoneProvider timeZone="Europe/Oslo">
      <PendingActivitiesSection
        activities={activities}
        onSubmitComment={() => Promise.resolve(null)}
        onNoComment={() => Promise.resolve()}
        onDelete={() => Promise.resolve()}
      />
    </TimeZoneProvider>,
  );
}

describe("PendingActivitiesSection", () => {
  it("renders nothing when no activity needs attention", () => {
    expect(render([])).toBe("");
  });

  it("renders the heading and the activity cards", () => {
    const html = render([activity]);

    expect(html).toContain("Recent activities");
    expect(html).toContain("Add a comment, or mark it with no comment.");
    expect(html).toContain("Morning Run");
    expect(html).toContain('data-testid="pending-activities"');
  });
});
