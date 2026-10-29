import { describe, expect, it } from "bun:test";
import {
  analyzedActivitiesResponseSchema,
  analyzedActivitySchema,
  llmModelSchema,
  llmSettingsSchema,
  llmSettingsUpdateSchema,
} from "./index";

const summary = {
  id: 42,
  name: "Morning Run",
  type: "running",
  startDate: "2026-10-01T06:30:00Z",
  distance: 5000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
  sampleCount: 1,
};

describe("llmModelSchema", () => {
  it("defaults missing optional fields to null", () => {
    const parsed = llmModelSchema.parse({
      id: "openrouter/auto",
      name: "Auto",
    });
    expect(parsed.contextLength).toBeNull();
    expect(parsed.promptPricePerMillion).toBeNull();
    expect(parsed.completionPricePerMillion).toBeNull();
  });
});

describe("llmSettingsSchema", () => {
  it("represents an unconfigured provider without a key", () => {
    const parsed = llmSettingsSchema.parse({
      configured: false,
      provider: "openrouter",
      model: null,
    });
    expect(parsed.configured).toBe(false);
    expect("apiKey" in parsed).toBe(false);
  });
});

describe("llmSettingsUpdateSchema", () => {
  it("allows omitting the API key when it is already stored", () => {
    const parsed = llmSettingsUpdateSchema.parse({ model: "openrouter/auto" });
    expect(parsed.apiKey).toBeUndefined();
  });

  it("rejects an empty model", () => {
    expect(() =>
      llmSettingsUpdateSchema.parse({ model: "", apiKey: "sk-or-v1-x" }),
    ).toThrow();
  });
});

describe("analyzedActivitySchema", () => {
  it("accepts an activity with a coach analysis", () => {
    const parsed = analyzedActivitySchema.parse({
      ...summary,
      analysis: {
        text: "Nice steady effort.",
        model: "openrouter/auto",
        generatedAt: "2026-10-01T07:00:00Z",
      },
    });
    expect(parsed.analysis?.text).toBe("Nice steady effort.");
    expect(parsed.analysisError).toBeNull();
  });

  it("defaults a missing analysis to null", () => {
    const parsed = analyzedActivitySchema.parse(summary);
    expect(parsed.analysis).toBeNull();
    expect(parsed.analysisError).toBeNull();
    expect(parsed.sampleCount).toBe(1);
    expect(parsed.programAnalysis).toBeNull();
    expect(parsed.comment).toBeNull();
    expect(parsed.coachReply).toBeNull();
  });

  it("carries the program review, comment, and coach reply", () => {
    const parsed = analyzedActivitySchema.parse({
      ...summary,
      programAnalysis: {
        text: "This fit the base block well, but the finish was too hard.",
        model: "openrouter/auto",
        generatedAt: "2026-10-01T07:00:00Z",
      },
      comment: "Felt strong on the hills.",
      coachReply: {
        text: "Good work; I will keep Thursday easy.",
        model: "openrouter/auto",
        generatedAt: "2026-10-01T07:05:00Z",
      },
    });
    expect(parsed.programAnalysis?.text).toContain("fit the base block");
    expect(parsed.comment).toBe("Felt strong on the hills.");
    expect(parsed.coachReply?.text).toContain("Thursday easy");
  });

  it("carries the downsampled sample preview", () => {
    const parsed = analyzedActivitySchema.parse({
      ...summary,
      samples: [{ timestamp: "2026-10-01T06:30:00Z", heartRate: 140 }],
    });
    expect(parsed.samples).toEqual([
      { timestamp: "2026-10-01T06:30:00Z", heartRate: 140 },
    ]);
  });

  it("defaults missing samples to an empty list", () => {
    expect(analyzedActivitySchema.parse(summary).samples).toEqual([]);
  });
});

describe("analyzedActivitiesResponseSchema", () => {
  it("requires a model and an activities array", () => {
    const parsed = analyzedActivitiesResponseSchema.parse({
      model: "openrouter/auto",
      activities: [summary],
    });
    expect(parsed.activities).toHaveLength(1);
    expect(() =>
      analyzedActivitiesResponseSchema.parse({ model: "x" }),
    ).toThrow();
  });

  it("allows a null model before OpenRouter is configured", () => {
    const parsed = analyzedActivitiesResponseSchema.parse({
      model: null,
      activities: [summary],
    });
    expect(parsed.model).toBeNull();
  });
});
