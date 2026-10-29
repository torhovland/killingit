import { describe, expect, it } from "bun:test";
import type { Activity, WeekPlan } from "@killingit/shared";
import {
  buildActivityAnalysisMessages,
  buildActivityAnalysisPrompt,
  channelStats,
  downsampleSamples,
  formatDuration,
  MAX_PROMPT_SAMPLES,
} from "./activityPrompt.js";
import { GLOBAL_PROMPT_RULES } from "./promptRules.js";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    name: "Morning Ride",
    type: "cycling",
    startDate: "2026-10-01T06:30:00Z",
    distance: 20000,
    movingTime: 2400,
    elapsedTime: 2600,
    totalElevationGain: 240,
    samples: [
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
    ],
    ...overrides,
  };
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

  it("labels running cadence in steps per minute", () => {
    const prompt = buildActivityAnalysisPrompt(
      makeActivity({ type: "running" }),
    );

    expect(prompt).toContain("cadence spm");
    expect(prompt).toContain("cadence: avg 88 spm");
    expect(prompt).not.toContain("cadence rpm");
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
      "Match it to the planned session for that date, today's planned session, or another session this week that fits the data.",
    );
    expect(prompt).toContain(
      "Include how well the workout fit its planned session",
    );
  });

  it("asks for body weight and body fat from the athlete's own words", () => {
    const system =
      buildActivityAnalysisMessages(makeActivity())[0]?.content ?? "";

    expect(system).toContain('"weightKg"');
    expect(system).toContain('"bodyFatPercent"');
    expect(system).toContain('"coachQuestions"');
    expect(system).toContain('"modelsRemarks"');
    expect(system).toContain("second person");
    expect(system).toContain("never estimate a weigh-in from the workout data");
    expect(system).toContain(GLOBAL_PROMPT_RULES);
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
