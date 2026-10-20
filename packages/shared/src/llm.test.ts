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
  });

  it("does not expose the full timeseries to the client", () => {
    const parsed = analyzedActivitySchema.parse({
      ...summary,
      samples: [{ timestamp: "2026-10-01T06:30:00Z", heartRate: 140 }],
    });
    expect("samples" in parsed).toBe(false);
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
