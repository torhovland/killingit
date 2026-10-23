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

  it("includes the activity program review and the coach's reply", () => {
    const text = formatPlanContext(
      input({
        recentActivities: [
          {
            ...activity,
            programAnalysis: "The session matched the planned easy day.",
            coachReply: "Keep the next run just as relaxed.",
          },
        ],
        activityComments: [
          { activityId: "42", comment: "Felt easy throughout." },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Coach review against the plan: The session matched the planned easy day.",
    );
    expect(text).toContain(
      "Coach reply to that comment: Keep the next run just as relaxed.",
    );
  });

  it("includes completed week and block reviews with athlete feedback", () => {
    const text = formatPlanContext(
      input({
        periodReviews: [
          {
            kind: "week",
            title: "Week starting 2026-10-13",
            startDate: "2026-10-13",
            endDate: "2026-10-19",
            summary: "A consistent week of easy work.",
            comment: "I felt strong.",
            reply: "Keep the momentum.",
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Completed week: Week starting 2026-10-13 (2026-10-13 → 2026-10-19)",
    );
    expect(text).toContain("Coach summary: A consistent week of easy work.");
    expect(text).toContain("Athlete comment: I felt strong.");
    expect(text).toContain("Coach reply: Keep the momentum.");
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
