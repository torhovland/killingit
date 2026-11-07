import { describe, expect, it } from "bun:test";
import { analyzeFood } from "./foodAnalysis.js";
import type { FoodAnalysisInput } from "./foodPrompt.js";
import {
  LlmProviderError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./openrouter.js";

const photo = "data:image/jpeg;base64,QUJD";

function input(overrides: Partial<FoodAnalysisInput> = {}): FoodAnalysisInput {
  return {
    context: {
      athleteAnswers: [],
      recentActivities: [],
      today: "2026-11-07",
    },
    eatenDate: "2026-11-07",
    eatenTime: "12:30",
    description: "A cheese sandwich",
    photoDataUrl: photo,
    ...overrides,
  };
}

const analysis = {
  meal: "A cheese sandwich",
  carbsGrams: 40,
  proteinGrams: 15,
  fatGrams: 10,
  caloriesKcal: 320,
  dietFit: "Fine before an easy run.",
};

class FailingThenAnsweringProvider implements LlmProvider {
  readonly id = "fake";
  readonly requests: LlmCompletionRequest[] = [];

  listModels() {
    return Promise.resolve([]);
  }

  validateKey() {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return Promise.reject(new LlmProviderError("no vision support", 500));
    }
    return Promise.resolve(JSON.stringify(analysis));
  }
}

class AlwaysFailingProvider extends FailingThenAnsweringProvider {
  override complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return Promise.reject(new LlmProviderError("no vision support", 500));
  }
}

describe("analyzeFood", () => {
  it("retries without the photo when a described meal fails", async () => {
    const provider = new FailingThenAnsweringProvider();
    const result = await analyzeFood(
      provider,
      { apiKey: "key", model: "test/model" },
      input(),
    );

    expect(result.analysis.carbsGrams).toBe(40);
    expect(provider.requests).toHaveLength(2);
    const retry = provider.requests[1];
    expect(typeof retry?.messages[1]?.content).toBe("string");
    expect(JSON.stringify(retry?.messages)).toContain("No photo was attached.");
  });

  it("does not retry a photo-only meal without the photo", async () => {
    const provider = new AlwaysFailingProvider();

    const error = await analyzeFood(
      provider,
      { apiKey: "key", model: "test/model" },
      input({ description: null }),
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("no vision support");
    expect(provider.requests).toHaveLength(1);
  });
});
