import { describe, expect, it } from "bun:test";
import type { Activity } from "@killingit/shared";
import {
  buildActivityAnalysisPrompt,
  channelStats,
  downsampleSamples,
  formatDuration,
  MAX_PROMPT_SAMPLES,
} from "./activityPrompt.js";

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
