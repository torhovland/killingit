import { describe, expect, it } from "bun:test";
import type { Activity } from "@killingit/shared";
import { analyzeActivity } from "./analyze.js";
import {
  LlmTokenLimitError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";
import { ANALYSIS_MAX_TOKENS } from "./planBudget.js";

const activity: Activity = {
  id: 1,
  name: "Morning Run",
  type: "running",
  startDate: "2026-10-01T06:30:00Z",
  distance: 5000,
  movingTime: 1500,
  elapsedTime: 1600,
  totalElevationGain: 55,
  samples: [{ timestamp: "2026-10-01T06:30:00Z", heartRate: 140 }],
};

class FakeProvider implements LlmProvider {
  readonly id = "test";
  readonly requests: LlmCompletionRequest[] = [];

  constructor(private readonly outcomes: Array<string | Error>) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    const outcome = this.outcomes[this.requests.length - 1];
    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }
    return Promise.resolve(outcome ?? "");
  }
}

describe("analyzeActivity", () => {
  it("asks for a complete analysis with enough output budget", async () => {
    const provider = new FakeProvider([
      JSON.stringify({
        analysis: "Solid aerobic effort.",
        estimatedFtpWatts: 255,
      }),
    ]);

    const result = await analyzeActivity(
      provider,
      { apiKey: "test-key", model: "test/model" },
      activity,
    );

    const captured = provider.requests[0];
    expect(result).toEqual({
      analysis: "Solid aerobic effort.",
      estimatedFtpWatts: 255,
      weightKg: null,
      bodyFatPercent: null,
      // The response omits the flag, so it fails open.
      planChangeNeeded: true,
    });
    expect(captured?.model).toBe("test/model");
    expect(captured?.apiKey).toBe("test-key");
    expect(captured?.maxTokens).toBe(ANALYSIS_MAX_TOKENS);
    expect(captured?.kind).toBe("activity_analysis");
    expect(captured?.messages).toHaveLength(2);
    expect(captured?.messages[1]?.content).toContain("Time series:");
  });

  it("retries with reasoning disabled when reasoning exhausts the budget", async () => {
    const provider = new FakeProvider([
      new LlmTokenLimitError("limit"),
      JSON.stringify({
        analysis: "Solid aerobic effort.",
        estimatedFtpWatts: null,
      }),
    ]);

    const result = await analyzeActivity(
      provider,
      { apiKey: "test-key", model: "test/model" },
      activity,
    );

    expect(result.analysis).toBe("Solid aerobic effort.");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.reasoning).toEqual({ effort: "none" });
  });

  it("keeps a plain-text analysis from a model that ignores the JSON contract", async () => {
    const provider = new FakeProvider(["Solid aerobic effort."]);

    const result = await analyzeActivity(
      provider,
      { apiKey: "test-key", model: "test/model" },
      activity,
    );

    expect(result).toEqual({
      analysis: "Solid aerobic effort.",
      estimatedFtpWatts: null,
      weightKg: null,
      bodyFatPercent: null,
      planChangeNeeded: true,
    });
  });

  it("carries the coach's judgement that the workout needs no plan change", async () => {
    const provider = new FakeProvider([
      JSON.stringify({
        analysis: "An easy recovery spin that went as planned.",
        planChangeNeeded: false,
      }),
    ]);

    const result = await analyzeActivity(
      provider,
      { apiKey: "test-key", model: "test/model" },
      activity,
    );

    expect(result.planChangeNeeded).toBe(false);
  });

  it("keeps the analysis when the flag is malformed and fails open", async () => {
    const provider = new FakeProvider([
      JSON.stringify({
        analysis: "Solid aerobic effort.",
        planChangeNeeded: "no",
      }),
    ]);

    const result = await analyzeActivity(
      provider,
      { apiKey: "test-key", model: "test/model" },
      activity,
    );

    expect(result.analysis).toBe("Solid aerobic effort.");
    expect(result.planChangeNeeded).toBe(true);
  });
});
