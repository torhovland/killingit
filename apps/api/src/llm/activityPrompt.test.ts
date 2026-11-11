import { describe, expect, it } from "bun:test";
import type { Activity, ActivitySample, WeekPlan } from "@killingit/shared";
import { makeActivity as makeFixtureActivity } from "../testFixtures/plan.js";
import {
  buildActivityAnalysisMessages,
  buildActivityAnalysisPrompt,
  channelStats,
  downsampleSamples,
  formatDuration,
  MAX_PROMPT_SAMPLES,
} from "./activityPrompt.js";
import {
  ACTIVITY_EXTRA_PRAISE_RULES,
  ACTIVITY_PRAISE_RULES,
  GLOBAL_PROMPT_RULES,
  TEXT_FORMATTING_RULES,
} from "./promptRules.js";

const samples: ActivitySample[] = [
  {
    timestamp: "2026-10-01T06:30:00Z",
    heartRate: 120,
    power: 180,
    speed: 7.5,
    distance: 0,
    elevation: 40,
    cadence: 85,
    temperature: 12,
  },
  {
    timestamp: "2026-10-01T06:40:00Z",
    heartRate: 150,
    power: 240,
    speed: 9,
    distance: 5000,
    elevation: 80,
    cadence: 90,
    temperature: 13,
  },
  {
    timestamp: "2026-10-01T06:50:00Z",
    heartRate: 165,
    power: 210,
    speed: 8,
    distance: 10000,
    elevation: 60,
    cadence: 88,
    temperature: 14,
  },
];

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return makeFixtureActivity({
    name: "Morning Ride",
    startDate: "2026-10-01T06:30:00Z",
    distance: 20000,
    movingTime: 2400,
    elapsedTime: 2600,
    totalElevationGain: 240,
    samples,
    ...overrides,
  });
}

describe("downsampleSamples", () => {
  it("keeps every sample when under the limit", () => {
    const samples = makeActivity().samples;
    expect(downsampleSamples(samples, 10)).toHaveLength(3);
  });

  it("caps the sample count and keeps the first and last points", () => {
    const samples = Array.from({ length: 1000 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 9, 1, 6, 0, index)).toISOString(),
      heartRate: 100 + (index % 50),
    }));
    const picked = downsampleSamples(samples, MAX_PROMPT_SAMPLES);
    expect(picked).toHaveLength(MAX_PROMPT_SAMPLES);
    expect(picked[0]).toEqual(samples[0]);
    expect(picked[picked.length - 1]).toEqual(samples[samples.length - 1]);
  });
});

describe("channelStats", () => {
  it("computes min, max, and average", () => {
    const stats = channelStats(makeActivity().samples, "heartRate");
    expect(stats).toEqual({ min: 120, max: 165, avg: 145, count: 3 });
  });

  it("returns null for a channel that was never recorded", () => {
    expect(channelStats(makeActivity().samples, "cadence")).not.toBeNull();
    expect(
      channelStats(
        makeActivity().samples.map((sample) => ({
          timestamp: sample.timestamp,
        })),
        "cadence",
      ),
    ).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats minutes/seconds and hours", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});

describe("buildActivityAnalysisPrompt", () => {
  it("includes the summary, aggregate stats, and the time series", () => {
    const prompt = buildActivityAnalysisPrompt(makeActivity());

    expect(prompt).toContain("Morning Ride");
    expect(prompt).toContain("20.00 km");
    expect(prompt).toContain("Aggregate values");
    expect(prompt).toContain("heart rate: avg 145 bpm");
    expect(prompt).toContain("Time series:");
    expect(prompt).toContain("elapsed | distance km | HR bpm | power W");
    expect(prompt).toContain("0:00 | 0.00 | 120 | 180");
    expect(prompt).toContain("10:00 | 5.00 | 150 | 240");
  });

  it("includes recorded laps with their averages", () => {
    const prompt = buildActivityAnalysisPrompt(
      makeActivity({
        laps: [
          {
            index: 1,
            type: "active",
            movingTime: 600,
            distance: 3050,
            averagePower: 180,
            maxPower: 240,
            averageSpeed: 7.5,
            averageHeartRate: 135,
            maxHeartRate: 142,
            averageCadence: 88,
            totalElevationGain: 12,
          },
          { index: 2, type: "rest", movingTime: 120, averageHeartRate: 110 },
        ],
      }),
    );

    expect(prompt).toContain("Recorded laps:");
    expect(prompt).toContain(
      "- Lap 1 (active): 10:00, 3.05 km, avg 180 W, max 240 W, 27.0 km/h, avg 135 bpm, max 142 bpm, 88 rpm, 12 m climb",
    );
    expect(prompt).toContain("- Lap 2 (rest): 2:00, avg 110 bpm");
  });

  it("omits a single recorded lap", () => {
    const prompt = buildActivityAnalysisPrompt(
      makeActivity({ laps: [{ index: 1, movingTime: 2400 }] }),
    );

    expect(prompt).not.toContain("Recorded laps:");
  });

  it("labels running cadence in steps per minute", () => {
    const prompt = buildActivityAnalysisPrompt(
      makeActivity({ type: "running" }),
    );

    expect(prompt).toContain("cadence spm");
    expect(prompt).toContain("cadence: avg 88 spm");
    expect(prompt).not.toContain("cadence rpm");
  });

  it("shows pace instead of speed for pace-based activities", () => {
    const running = buildActivityAnalysisPrompt(
      makeActivity({ type: "running" }),
    );
    expect(running).toContain("pace /km");
    expect(running).toContain("Average pace: 2:00 /km");
    expect(running).toContain("pace: avg 2:02 /km");
    expect(running).not.toContain("speed km/h");

    const rowing = buildActivityAnalysisPrompt(
      makeActivity({ type: "indoor_rowing" }),
    );
    expect(rowing).toContain("pace /500m");
    expect(rowing).toContain("Average pace: 1:00 /500m");
  });

  it("keeps speed for rides and other speed-based activities", () => {
    const prompt = buildActivityAnalysisPrompt(makeActivity());

    expect(prompt).toContain("speed km/h");
    expect(prompt).toContain("Average speed: 30.0 km/h");
    expect(prompt).not.toContain("pace /km");
  });

  it("renders the recorded strength sets instead of inventing them", () => {
    const squat = {
      setType: "active",
      repetitions: 10,
      weightKg: 12,
      exercises: [{ category: "SQUAT", name: "GOBLET_SQUAT" }],
    };
    const prompt = buildActivityAnalysisPrompt(
      makeActivity({
        type: "strength_training",
        samples: [],
        strengthSets: [
          squat,
          squat,
          squat,
          {
            setType: "rest",
            durationSeconds: 60,
            exercises: [],
          },
        ],
      }),
    );

    expect(prompt).toContain("Recorded strength sets:");
    expect(prompt).toContain("Goblet squat: 3 × 10 reps at 12 kg");
    expect(prompt).toContain("Rest between sets: 60 s");

    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";
    expect(system).toContain("do not assume a strength workout was performed");
  });

  it("includes stored weigh-ins with their sources and the precedence rule", () => {
    const prompt = buildActivityAnalysisPrompt(makeActivity(), {
      today: "2026-10-01",
      bodyHistory: {
        weight: [
          { date: "2026-09-30", value: 78.5, source: "garmin" },
          { date: "2026-10-01", value: 78, source: "user" },
          { date: "2026-10-02", value: 77.9, source: "garmin" },
        ],
        bodyFat: [{ date: "2026-09-30", value: 24.4, source: "garmin" }],
      },
    });

    expect(prompt).toContain("- 2026-09-30: 78.5 kg (garmin)");
    expect(prompt).toContain("- 2026-10-01: 78.0 kg (user)");
    expect(prompt).toContain("- 2026-09-30: 24.4 % (garmin)");
    expect(prompt).not.toContain("77.9 kg");

    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";
    expect(system).toContain("the athlete's own statement wins");
  });

  it("includes the recovery context up to the activity date", () => {
    const prompt = buildActivityAnalysisPrompt(makeActivity(), {
      today: "2026-10-01",
      dailyHealth: [
        { metric: "sleep_duration", date: "2026-09-30", value: 420 },
        { metric: "sleep_duration", date: "2026-10-02", value: 300 },
      ],
    });

    expect(prompt).toContain("Daily health and recovery");
    expect(prompt).toContain("latest 7 h on 2026-09-30");
    expect(prompt).not.toContain("5 h on 2026-10-02");
  });

  it("explains incomplete recordings and refuses an FTP guess without data", () => {
    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";

    expect(system).toContain("an indoor session may have no moving time");
    expect(system).toContain("may or may not have power or heart-rate data");
    expect(system).toContain("do not guess an FTP change from incomplete");
  });

  it("includes the week plan so the coach can match the activity to a session", () => {
    const week: WeekPlan = {
      startDate: "2026-09-28",
      focus: "Aerobic base",
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, "0")}`,
        day: "Monday",
        type: index === 2 ? ("rest" as const) : ("workout" as const),
        title: index === 0 ? "Easy ride" : `Session ${index + 1}`,
        description: "Steady aerobic work.",
        durationMinutes: 60,
        intensity: index === 0 ? ("easy" as const) : ("moderate" as const),
        status: "planned" as const,
      })),
    };

    const messages = buildActivityAnalysisMessages(makeActivity(), {
      today: "2026-10-01",
      week,
    });
    const prompt = messages[1]?.content ?? "";

    expect(prompt).toContain("Current week plan:");
    expect(prompt).toContain("2026-10-01 (Monday) [planned]: Easy ride");
    expect(prompt).toContain(
      "Planned session for 2026-10-01: Easy ride [workout, easy, 60 min]",
    );
    expect(prompt).toContain("Match the workout to it.");
    expect(prompt).toContain(
      "Include how well the workout fit its planned session",
    );
  });

  it("does not match an activity that happened outside the supplied week", () => {
    const week: WeekPlan = {
      startDate: "2026-10-05",
      focus: "Aerobic base",
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 5).padStart(2, "0")}`,
        day: "Monday",
        type: "workout" as const,
        title: index === 0 ? "Run-walk" : `Session ${index + 1}`,
        description: "Steady aerobic work.",
        durationMinutes: 60,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    };

    const messages = buildActivityAnalysisMessages(
      makeActivity({ type: "running" }),
      {
        today: "2026-10-26",
        season: {
          goal: "Run a marathon",
          startDate: "2026-10-05",
          endDate: "2027-04-01",
          rationale: "Build a base.",
          blocks: [
            {
              name: "Base",
              focus: "Aerobic",
              startDate: "2026-10-05",
              endDate: "2026-12-01",
              weekCount: 6,
            },
          ],
        },
        block: {
          name: "Base",
          focus: "Aerobic",
          rationale: "Consistent volume.",
          startDate: "2026-10-05",
          endDate: "2026-12-01",
          weeks: [
            {
              number: 1,
              startDate: "2026-10-05",
              focus: "Aerobic",
              targetLoad: "Easy",
            },
          ],
        },
        week,
      },
    );
    const prompt = messages[1]?.content ?? "";

    expect(prompt).toContain("Current season plan:");
    expect(prompt).toContain("Current block plan:");
    expect(prompt).toContain(
      "The workout happened on 2026-10-01, outside the current week (2026-10-05 to 2026-10-11).",
    );
    expect(prompt).toContain("No planned session is available for that date.");
    expect(prompt).toContain(
      "Do not match it to a session in the current week",
    );
    expect(prompt).toContain("review the workout on its own merits");
    expect(prompt).toContain("relate it to the current block's focus");
    expect(prompt).not.toContain("Current week plan:");
    expect(prompt).not.toContain(
      "Match it to the planned session for that date",
    );
    expect(prompt).toContain(
      "Do not compare the workout to the current week plan",
    );
    expect(prompt).not.toContain(
      "Include how well the workout fit its planned session",
    );
  });

  it("includes the athlete's comment and trusts it over the device label", () => {
    const messages = buildActivityAnalysisMessages(
      makeActivity(),
      undefined,
      "This was a double spinning class. 2x45 minutes with 15 minutes break in-between.",
    );

    expect(messages[1]?.content).toContain("Athlete comment on this activity");
    expect(messages[1]?.content).toContain("double spinning class");
    expect(messages[1]?.content).toContain("not an additional session");
    expect(messages[0]?.content).toContain(
      "treat the comment as authoritative over the device label",
    );
  });

  it("asks for body weight and body fat from the athlete's own words", () => {
    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";

    expect(system).toContain('"weightKg"');
    expect(system).toContain('"bodyFatPercent"');
    expect(system).toContain('"coachQuestion"');
    expect(system).toContain('"modelsRemarks"');
    expect(system).toContain("second person");
    expect(system).toContain("never estimate a weigh-in from the workout data");
    expect(system).toContain(GLOBAL_PROMPT_RULES);
  });

  it("does not treat a near-target duration as short or long", () => {
    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";

    expect(system).toContain(
      "a two-hour session recorded as 1:50 or 2:05 matched its plan",
    );
    expect(system).toContain("build on it instead of inventing a correction");
  });

  it("asks for paragraphs and lists in the review", () => {
    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";

    expect(system).toContain(TEXT_FORMATTING_RULES);
  });

  it("praises a well-performed race or extraordinary effort", () => {
    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";

    expect(system).toContain(ACTIVITY_PRAISE_RULES);
    expect(system).toContain("tell them plainly that they are killing it");
  });

  it("adds the extra praise when the draw is 0", () => {
    const messages = buildActivityAnalysisMessages(
      makeActivity(),
      undefined,
      null,
      () => 0,
    );

    expect(messages[1]?.content).toContain(ACTIVITY_EXTRA_PRAISE_RULES);
    expect(messages[1]?.content).toContain(
      "even though it was not a race or an effort far above their ordinary training",
    );
  });

  it("leaves out the extra praise for any other draw", () => {
    const prompt = buildActivityAnalysisPrompt(
      makeActivity(),
      undefined,
      null,
      () => 1 / 15,
    );

    expect(prompt).not.toContain(ACTIVITY_EXTRA_PRAISE_RULES);
  });

  it("does not trust the recorded activity type", () => {
    const messages = buildActivityAnalysisMessages(makeActivity());

    expect(messages[0]?.content).toContain("do not trust it");
    expect(messages[0]?.content).toContain("strength-training workout");
    expect(messages[1]?.content).toContain(
      "Type (recorded by the device; may be wrong)",
    );
  });

  it("handles an activity without recorded samples", () => {
    const prompt = buildActivityAnalysisPrompt(makeActivity({ samples: [] }));
    expect(prompt).toContain(
      "No time-series samples were recorded for this activity.",
    );
  });

  it("notes when the series was downsampled", () => {
    const samples = Array.from({ length: 120 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 9, 1, 6, 0, index)).toISOString(),
      heartRate: 140,
    }));
    const prompt = buildActivityAnalysisPrompt(makeActivity({ samples }));
    expect(prompt).toContain("90 of 120 samples shown");
  });
});
