import { describe, expect, it } from "bun:test";
import {
  ACTIVITY_COMMENT_RULE,
  formatPlanContext,
  type PlanContextInput,
  type RecentActivityContext,
} from "./planContext.js";

const activity: RecentActivityContext = {
  summary: {
    id: 42,
    name: "Strength training",
    type: "cardio",
    startDate: "2026-10-22T17:00:00Z",
    distance: 0,
    movingTime: 2400,
    elapsedTime: 2400,
    totalElevationGain: 0,
  },
  analysis: "A short strength session recorded as cardio.",
};

function input(overrides: Partial<PlanContextInput> = {}): PlanContextInput {
  return {
    athleteAnswers: [],
    recentActivities: [activity],
    today: "2026-10-22",
    ...overrides,
  };
}

describe("formatPlanContext", () => {
  it("attaches a comment to the activity it describes", () => {
    const lines = formatPlanContext(
      input({
        activityComments: [
          {
            activityId: "42",
            comment: "Goblet squats, glute bridges, and planks.",
          },
        ],
      }),
    );
    const text = lines.join("\n");

    expect(text).toContain(
      "Athlete comment about this same activity (not an additional session): Goblet squats",
    );
    expect(text).toContain(ACTIVITY_COMMENT_RULE);
    expect(text).not.toContain("Activity comments:");
  });

  it("keeps comments for unlisted activities clearly separate", () => {
    const text = formatPlanContext(
      input({
        activityComments: [{ activityId: "99", comment: "An older session." }],
      }),
    ).join("\n");

    expect(text).toContain("Activity comments:");
    expect(text).toContain(
      "Each comment describes the activity with the matching ID. It is not a separate activity or extra training.",
    );
    expect(text).toContain("- Activity 99: An older session.");
  });
});
