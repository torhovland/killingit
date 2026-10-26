import { describe, expect, it } from "bun:test";
import { generateCoachPlan } from "./coachPlan.js";
import type { LlmProvider } from "./openrouter.js";

describe("generateCoachPlan", () => {
  it("sends the plan prompt through the provider", async () => {
    const provider: LlmProvider = {
      id: "test",
      listModels: () => Promise.resolve([]),
      validateKey: () => Promise.resolve(),
      complete: (request) => {
        expect(request.apiKey).toBe("test-key");
        expect(request.model).toBe("test-model");
        expect(request.temperature).toBe(0.4);
        expect(request.maxTokens).toBe(16_384);
        expect(request.messages).toHaveLength(2);
        expect(request.messages[0]?.content).toContain(
          "state of the art training science",
        );
        expect(request.messages[1]?.content).toContain(
          "Today's date: 2026-10-21",
        );
        return Promise.resolve('{"season":{}}');
      },
    };

    const text = await generateCoachPlan(
      provider,
      { apiKey: "test-key", model: "test-model" },
      {
        today: "2026-10-21",
        athleteAnswers: [],
        recentActivities: [],
      },
    );

    expect(text).toBe('{"season":{}}');
  });
});
