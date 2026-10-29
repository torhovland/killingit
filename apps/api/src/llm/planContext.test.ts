import { describe, expect, it } from "bun:test";
import {
  formatPlanContext,
  formatWeekPlan,
  type PlanContextInput,
  type RecentActivityContext,
} from "./planContext.js";
import { ACTIVITY_COMMENT_RULE } from "./promptRules.js";

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

  it("includes the weekly note and the coach's reply to it", () => {
    const text = formatPlanContext(
      input({
        weeklyNote: "I can only train before work this week.",
        weeklyNoteReply: "Then keep the weekday sessions short and easy.",
      }),
    ).join("\n");

    expect(text).toContain(
      "Weekly note for the week starting 2026-10-19 (2026-10-19 → 2026-10-25):\nI can only train before work this week.",
    );
    expect(text).toContain(
      "Coach reply to the weekly note:\nThen keep the weekday sessions short and easy.",
    );
    expect(text).toContain(
      "A weekly note is normally scoped to the week it was written for.",
    );
  });

  it("includes the athlete's FTP and recorded power", () => {
    const text = formatPlanContext(
      input({
        athleteFtpWatts: 250,
        recentActivities: [
          {
            ...activity,
            summary: {
              ...activity.summary,
              normalizedPower: 200,
              averagePower: 195,
            },
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Athlete FTP: 250 W (the latest FTP the athlete stated or the coach estimated as of today)",
    );
    expect(text).toContain("NP 200 W (average 195 W)");
  });

  it("dates the profile so an undated weight is not read as today's", () => {
    const text = formatPlanContext(
      input({
        athleteAnswers: [
          {
            prompt: "Health goals?",
            answer: "I am 89,5 kg and 24,5 % body fat.",
            skipped: false,
            answeredAt: new Date("2026-10-20T08:00:00Z"),
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain("Athlete profile (answers last saved 2026-10-20):");
    expect(text).toContain("I am 89,5 kg and 24,5 % body fat.");
  });

  it("includes the stored body weight and body-fat history", () => {
    const text = formatPlanContext(
      input({
        bodyHistory: {
          weight: [
            { date: "2026-10-20", value: 90, source: "user" },
            { date: "2026-10-22", value: 89.5, source: "coach" },
          ],
          bodyFat: [{ date: "2026-10-20", value: 24.5, source: "garmin" }],
        },
      }),
    ).join("\n");

    expect(text).toContain(
      'Body weight history (oldest first; "user" and "garmin" values are measurements, "coach" values are earlier estimates):',
    );
    expect(text).toContain("- 2026-10-20: 90.0 kg (user)");
    expect(text).toContain("- 2026-10-22: 89.5 kg (coach)");
    expect(text).toContain("- 2026-10-20: 24.5 % (garmin)");
  });

  it("omits a body history that has no measurements", () => {
    const text = formatPlanContext(
      input({ bodyHistory: { weight: [], bodyFat: [] } }),
    ).join("\n");

    expect(text).not.toContain("Body weight history");
    expect(text).not.toContain("Body fat history");
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

  it("renders the forecast with units and the location name", () => {
    const text = formatPlanContext(
      input({
        locationName: "Oslo, Norway",
        forecast: [
          {
            date: "2026-10-25",
            icon: "sun",
            temperatureMaxC: 12.4,
            temperatureMinC: 4.2,
            windMaxMs: 4.6,
            gustMaxMs: 8.2,
            precipitationMm: 0,
            sunrise: "07:45",
            sunset: "16:30",
          },
          {
            date: "2026-10-26",
            icon: "rain",
            temperatureMaxC: 9.1,
            temperatureMinC: 3.8,
            windMaxMs: 6.2,
            gustMaxMs: 11.4,
            precipitationMm: 3.6,
            sunrise: "07:47",
            sunset: "16:27",
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain(
      "Combined daily weather and daylight forecast for Oslo, Norway",
    );
    expect(text).toContain("Temperatures are in °C");
    expect(text).toContain("sunrise and sunset are local clock times");
    expect(text).toContain(
      "- 2026-10-25: Sunny (sun), 4–12 °C, wind up to 5 m/s, gusts up to 8 m/s, 0.0 mm precipitation, sunrise 07:45, sunset 16:30",
    );
    expect(text).toContain(
      "- 2026-10-26: Rain (rain), 4–9 °C, wind up to 6 m/s, gusts up to 11 m/s, 3.6 mm precipitation, sunrise 07:47, sunset 16:27",
    );
  });

  it("omits daylight times when the forecast has none", () => {
    const text = formatPlanContext(
      input({
        forecast: [
          {
            date: "2026-10-25",
            icon: "sun",
            temperatureMaxC: 12.4,
            temperatureMinC: 4.2,
            windMaxMs: 4.6,
            gustMaxMs: 8.2,
            precipitationMm: 0,
          },
        ],
      }),
    ).join("\n");

    expect(text).toContain("0.0 mm precipitation");
    expect(text).not.toMatch(/sunrise \d{2}:\d{2}/);
    expect(text).not.toMatch(/sunset \d{2}:\d{2}/);
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

  it("renders the power targets of a structured bike workout", () => {
    const text = formatWeekPlan({
      startDate: "2026-10-19",
      focus: "Threshold",
      rationale: "Build power.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${19 + index}`,
        day: "Monday",
        type: "workout" as const,
        title: `Session ${index + 1}`,
        description: "Indoor trainer ride.",
        durationMinutes: 30,
        intensity: "moderate" as const,
        status: "planned" as const,
        ...(index === 2
          ? {
              outdoor: false,
              canBeOutdoor: false,
              bikeWorkout: {
                ftpWatts: 220,
                intervals: [
                  { durationSeconds: 600, powerPercent: 55 },
                  { durationSeconds: 480, powerPercent: 90 },
                ],
              },
            }
          : {}),
      })),
    });

    expect(text).toContain(
      "power targets at FTP 220 W: 600s at 55% FTP, 480s at 90% FTP",
    );
    expect(text).toContain("Indoor trainer ride.");
  });
});
