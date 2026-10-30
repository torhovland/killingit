import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity } from "@killingit/shared";
import { buildFtpTimelineFromPoints } from "../training/ftp.js";
import { loadReplyContext, type ReplyContextInput } from "./replyContext.js";

const input: ReplyContextInput = {
  userId: 42,
  today: "2026-10-21",
  athleteAnswers: [{ prompt: "Goal?", answer: "Marathon", skipped: false }],
};

function makeActivity(
  overrides: Partial<AnalyzedActivity> = {},
): AnalyzedActivity {
  return {
    id: 1,
    name: "Morning ride",
    type: "cycling",
    startDate: "2026-10-20T07:10:00Z",
    distance: 42000,
    movingTime: 5400,
    elapsedTime: 6000,
    totalElevationGain: 320,
    sampleCount: 500,
    samples: [],
    analysis: {
      text: "Steady aerobic ride.",
      model: "test-model",
      generatedAt: "2026-10-20T09:00:00Z",
    },
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
    ...overrides,
  };
}

describe("loadReplyContext", () => {
  it("assembles the athlete's training context for a reply", async () => {
    const context = await loadReplyContext(input, {
      loadActivities: () => Promise.resolve([makeActivity()]),
      loadCoachingInputs: () =>
        Promise.resolve({
          manualActivities: [
            {
              id: 3,
              startDate: "2026-10-18",
              details: "90 minutes easy spinning",
              estimatedTss: 55,
            },
          ],
          activityComments: [{ activityId: "1", comment: "Legs felt heavy." }],
          weeklyNote: "Busy week.",
          weeklyNoteWeekStartDate: "2026-10-19",
          weeklyNoteReply: "Keep it light.",
          weeklyNoteUpdatedAt: new Date("2026-10-19T08:00:00Z"),
          periodReviews: [
            {
              kind: "week",
              title: "Week starting 2026-10-12",
              startDate: "2026-10-12",
              endDate: "2026-10-18",
              summary: "A steady week.",
              comment: null,
              reply: null,
            },
          ],
          weekReviewUpdatedAt: null,
          blockReviewUpdatedAt: null,
          updatedAt: null,
        }),
      loadFtpHistory: () =>
        Promise.resolve({
          points: [
            { date: "2026-10-01", value: 240, source: "user" as const },
            { date: "2026-10-20", value: 250, source: "coach" as const },
            { date: "2026-11-15", value: 270, source: "coach" as const },
          ],
          timeline: buildFtpTimelineFromPoints(
            [
              { date: "2026-10-01", value: 240, source: "user" as const },
              { date: "2026-10-20", value: 250, source: "coach" as const },
              { date: "2026-11-15", value: 270, source: "coach" as const },
            ],
            "2026-10-21",
          ),
        }),
      loadBodyHistory: () =>
        Promise.resolve({
          weight: [{ date: "2026-10-01", value: 80, source: "user" as const }],
          bodyFat: [],
        }),
    });

    expect(context.today).toBe("2026-10-21");
    expect(context.athleteAnswers).toEqual(input.athleteAnswers);
    expect(context.recentActivities).toHaveLength(1);
    expect(context.recentActivities[0]?.summary.name).toBe("Morning ride");
    expect(context.recentActivities[0]?.analysis).toBe("Steady aerobic ride.");
    expect(context.manualActivities).toHaveLength(1);
    expect(context.activityComments).toHaveLength(1);
    expect(context.weeklyNote).toBe("Busy week.");
    expect(context.weeklyNoteWeekStartDate).toBe("2026-10-19");
    expect(context.weeklyNoteReply).toBe("Keep it light.");
    expect(context.periodReviews).toHaveLength(1);
    expect(context.athleteFtpWatts).toBe(250);
    expect(context.ftpHistory?.map((point) => point.date)).toEqual([
      "2026-10-01",
      "2026-10-20",
    ]);
    expect(context.bodyHistory?.weight).toHaveLength(1);
  });

  it("keeps the rest of the context when one source fails", async () => {
    const context = await loadReplyContext(input, {
      loadActivities: () => Promise.reject(new Error("Garmin is down")),
      loadCoachingInputs: () =>
        Promise.resolve({
          manualActivities: [],
          activityComments: [],
          weeklyNote: null,
          weeklyNoteWeekStartDate: null,
          weeklyNoteReply: null,
          weeklyNoteUpdatedAt: null,
          periodReviews: [],
          weekReviewUpdatedAt: null,
          blockReviewUpdatedAt: null,
          updatedAt: null,
        }),
      loadFtpHistory: () =>
        Promise.resolve({
          points: [{ date: "2026-10-01", value: 240, source: "user" as const }],
          timeline: buildFtpTimelineFromPoints([
            { date: "2026-10-01", value: 240, source: "user" as const },
          ]),
        }),
      loadBodyHistory: () => Promise.reject(new Error("no body metrics")),
    });

    expect(context.recentActivities).toEqual([]);
    expect(context.athleteFtpWatts).toBe(240);
    expect(context.bodyHistory).toBeUndefined();
  });

  it("returns an empty context when every source fails", async () => {
    const context = await loadReplyContext(input, {
      loadActivities: () => Promise.reject(new Error("no feed")),
      loadCoachingInputs: () => Promise.reject(new Error("no inputs")),
      loadFtpHistory: () => Promise.reject(new Error("no metrics")),
      loadBodyHistory: () => Promise.reject(new Error("no metrics")),
    });

    expect(context).toMatchObject({
      today: "2026-10-21",
      recentActivities: [],
      manualActivities: [],
      activityComments: [],
      periodReviews: [],
      athleteFtpWatts: null,
    });
  });
});
