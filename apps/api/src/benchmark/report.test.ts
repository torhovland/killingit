import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import type { BenchmarkResults } from "./types.js";
import { renderBenchmarkReport } from "./report.js";

const plan = {
  season: {
    goal: "Finish PBP",
    rationale: "Build.",
    startDate: "2026-10-26",
    endDate: "2027-08-26",
    blocks: [],
  },
  block: {
    name: "Rebuild",
    focus: "Easy.",
    rationale: "Recover.",
    startDate: "2026-10-26",
    endDate: "2026-11-22",
    weeks: [],
  },
  week: {
    startDate: "2026-10-26",
    focus: "Easy week.",
    rationale: "Recover.",
    sessions: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${26 + index}`,
      day: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ][index],
      type: "rest" as const,
      title: "Rest",
      description: "Rest.",
      durationMinutes: 0,
      intensity: "rest" as const,
      status: "rest" as const,
      outdoor: false,
      canBeOutdoor: false,
    })),
  },
  today: {
    date: "2026-10-26",
    type: "rest" as const,
    title: "Rest",
    description: "Rest.",
    durationMinutes: 0,
    intensity: "rest" as const,
    status: "rest" as const,
    alternatives: [],
    rationale: "Recover.",
    optional: false,
    optionalRationale: "Rest.",
    outdoor: false,
    canBeOutdoor: true,
  },
  tomorrow: null,
  nextWeek: null,
  nextBlock: null,
} as unknown as CoachPlan;

function results(): BenchmarkResults {
  return {
    metadata: {
      runId: "run-1",
      runAt: "2026-10-26T00:00:00.000Z",
      gitCommit: "abc123",
      userId: 1,
      today: "2026-10-26",
      refreshToday: "2026-11-02",
      benchmarkModel: "google/gemini-4-argon",
      models: ["google/gemini-4-argon", "anthropic/claude-opus-5.5"],
      planMaxTokens: 16_384,
      exclusions: ["No weather."],
    },
    models: {
      "google/gemini-4-argon": {
        model: "google/gemini-4-argon",
        pricing: null,
        full: {
          ok: true,
          wallMs: 100_000,
          costUsd: 0.2,
          promptTokens: 100,
          completionTokens: 50,
          reasoningTokens: 10,
          calls: [
            {
              step: "season",
              repair: false,
              maxTokens: 16_384,
              reasoning: null,
              startedAt: "2026-10-26T00:00:00.000Z",
              durationMs: 100_000,
              httpStatus: 200,
              finishReason: "stop",
              contentChars: 100,
              usage: null,
              error: null,
            },
          ],
          plan,
          error: null,
        },
        refresh: {
          ok: true,
          wallMs: 50_000,
          costUsd: 0.1,
          promptTokens: 50,
          completionTokens: 25,
          reasoningTokens: 5,
          calls: [],
          plan,
          error: null,
        },
        error: null,
      },
      "anthropic/claude-opus-5.5": {
        model: "anthropic/claude-opus-5.5",
        pricing: null,
        full: null,
        refresh: null,
        error: "provider failed",
      },
    },
  };
}

describe("renderBenchmarkReport", () => {
  it("marks the first model as the benchmark and shows cost ratios", () => {
    const report = renderBenchmarkReport(results(), {
      scores: {
        "google/gemini-4-argon": { quality: 9.5, notes: "Complete." },
        "anthropic/claude-opus-5.5": { quality: 4, notes: "Failed." },
      },
    });

    expect(report).toContain("`google/gemini-4-argon` **benchmark**");
    expect(report).toContain("9.5/10");
    expect(report).toContain("$0.3000");
    expect(report).toContain("1.00×");
    expect(report).toContain("No weather.");
    expect(report).toContain("Season 2026-10-26 → 2027-08-26");
    expect(report).toContain("Failed:");
  });

  it("renders without scores", () => {
    const report = renderBenchmarkReport(results());
    expect(report).toContain("| Model | Quality |");
    expect(report).not.toContain("## Quality scores");
  });
});
