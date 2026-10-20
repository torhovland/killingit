import { describe, expect, it } from "bun:test";
import type { Activity } from "@killingit/shared";
import { analyzeActivity } from "./analyze.js";
import type { LlmCompletionRequest, LlmProvider } from "./openrouter.js";

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

describe("analyzeActivity", () => {
  it("asks for a complete analysis with enough output budget", async () => {
    let captured: LlmCompletionRequest | undefined;
    const provider: LlmProvider = {
      id: "test",
      listModels: () => Promise.resolve([]),
      validateKey: () => Promise.resolve(),
      complete: (request) => {
        captured = request;
        return Promise.resolve("Solid aerobic effort.");
      },
    };

    const text = await analyzeActivity(
      provider,
      { apiKey: "test-key", model: "test/model" },
      activity,
    );

    expect(text).toBe("Solid aerobic effort.");
    expect(captured?.model).toBe("test/model");
    expect(captured?.apiKey).toBe("test-key");
    expect(captured?.maxTokens).toBe(2048);
    expect(captured?.messages).toHaveLength(2);
    expect(captured?.messages[1]?.content).toContain("Time series:");
  });
});
