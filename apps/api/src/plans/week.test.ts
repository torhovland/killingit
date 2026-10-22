import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, WeekPlan } from "@killingit/shared";
import { applyCompletedDays } from "./week.js";

function makeWeek(): WeekPlan {
  return {
    startDate: "2026-10-19",
    focus: "Aerobic base",
    rationale: "Keep the week easy.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(19 + index)}`,
      day: "Monday",
      type: index === 6 ? "rest" : "workout",
      title: `Session ${index + 1}`,
      description: "Easy aerobic work.",
      durationMinutes: 45,
      intensity: index === 6 ? "rest" : "easy",
      status: index === 6 ? "rest" : "planned",
    })),
  };
}

function makeActivity(
  overrides: Partial<AnalyzedActivity> = {},
): AnalyzedActivity {
  return {
    id: 1,
    name: "Morning Run",
    type: "running",
    startDate: "2026-10-19T06:30:00Z",
    distance: 10000,
    movingTime: 2700,
    elapsedTime: 2800,
    totalElevationGain: 80,
    sampleCount: 100,
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

describe("applyCompletedDays", () => {
  it("uses completed activities for past days and marks missing ones", () => {
    const week = applyCompletedDays(makeWeek(), [makeActivity()], "2026-10-21");

    expect(week.rationale).toBe("Keep the week easy.");

    const monday = week.sessions[0];
    expect(monday?.status).toBe("completed");
    expect(monday?.title).toBe("Morning Run");
    expect(monday?.description).toContain("Completed: running");
    expect(monday?.description).toContain("10.00 km");
    expect(monday?.durationMinutes).toBe(45);

    const tuesday = week.sessions[1];
    expect(tuesday?.status).toBe("missed");
    expect(tuesday?.title).toBe("No activity recorded");
    expect(tuesday?.durationMinutes).toBe(0);
  });

  it("keeps today and future days planned", () => {
    const week = applyCompletedDays(makeWeek(), [], "2026-10-21");

    expect(week.sessions[2]?.status).toBe("planned");
    expect(week.sessions[2]?.title).toBe("Session 3");
    expect(week.sessions[3]?.status).toBe("planned");
    expect(week.sessions[6]?.status).toBe("rest");
  });

  it("keeps a past rest day as rest", () => {
    const week = makeWeek();
    const restWeek: WeekPlan = {
      ...week,
      sessions: week.sessions.map((session, index) =>
        index === 0 ? { ...session, type: "rest", intensity: "rest" } : session,
      ),
    };

    const applied = applyCompletedDays(restWeek, [], "2026-10-21");
    expect(applied.sessions[0]?.status).toBe("rest");
  });
});
