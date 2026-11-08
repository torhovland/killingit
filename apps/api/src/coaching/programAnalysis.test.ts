import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import {
  llmMessageText,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../llm/openrouter.js";
import { PROGRAM_ANALYSIS_PROMPT_VERSION } from "../llm/programAnalysisPrompt.js";
import { analyzeActivitiesAgainstPlan } from "./programAnalysis.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Run a marathon",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build a base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-19",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Consistent volume.",
      startDate: "2026-10-19",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: "Easy run",
        description: "45 minutes easy.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    },
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      status: "planned",
    },
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
  };
}

function makeActivity(id: number, name: string): AnalyzedActivity {
  return {
    id,
    name,
    type: "running",
    startDate: "2026-10-19T06:30:00Z",
    distance: 10000,
    movingTime: 2700,
    elapsedTime: 2800,
    totalElevationGain: 80,
    sampleCount: 100,
    samples: [],
    analysis: null,
    analysisError: null,
    programAnalysis: null,
    comment: null,
    coachReply: null,
  };
}

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  requests: LlmCompletionRequest[] = [];

  constructor(private readonly failOn?: string) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    const content =
      request.messages[1] === undefined
        ? ""
        : llmMessageText(request.messages[1].content);
    if (this.failOn !== undefined && content.includes(this.failOn)) {
      return Promise.reject(new Error("review failed"));
    }
    return Promise.resolve("This fit the base block well.");
  }
}

class JsonProvider implements LlmProvider {
  readonly id = "fake";

  constructor(private readonly result: unknown) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(): Promise<string> {
    return Promise.resolve(JSON.stringify(this.result));
  }
}

describe("analyzeActivitiesAgainstPlan", () => {
  it("saves a program review for each activity", async () => {
    const saved: Array<{
      userId: number;
      activityId: number;
      kind: string | undefined;
      model: string;
      promptVersion: number;
      text: string;
    }> = [];

    await analyzeActivitiesAgainstPlan({
      userId: 42,
      provider: new FakeProvider(),
      apiKey: "test-key",
      model: "test-model",
      today: "2026-10-21",
      plan: makePlan(),
      activities: [
        makeActivity(1, "Morning Run"),
        makeActivity(2, "Evening Run"),
      ],
      activityComments: [{ activityId: "1", comment: "Felt strong." }],
      loadReviews: () => Promise.resolve(new Map()),
      save: (input) => {
        saved.push({ ...input, kind: input.kind ?? "general" });
        return Promise.resolve({
          activityId: input.activityId,
          kind: input.kind ?? "general",
          model: input.model,
          text: input.text,
          generatedAt: new Date(),
        });
      },
    });

    expect(saved).toHaveLength(2);
    expect(saved.map((entry) => entry.activityId).sort()).toEqual([1, 2]);
    expect(saved[0]?.userId).toBe(42);
    expect(saved[0]?.kind).toBe("program");
    expect(saved[0]?.model).toBe("test-model");
    expect(saved[0]?.promptVersion).toBe(PROGRAM_ANALYSIS_PROMPT_VERSION);
  });

  it("reuses a stored review instead of reviewing the activity again", async () => {
    const provider = new FakeProvider();
    const saved: number[] = [];

    await analyzeActivitiesAgainstPlan({
      userId: 42,
      provider,
      apiKey: "test-key",
      model: "test-model",
      today: "2026-10-21",
      plan: makePlan(),
      activities: [makeActivity(1, "Morning Run")],
      activityComments: [],
      loadReviews: () =>
        Promise.resolve(
          new Map([
            [
              1,
              {
                activityId: 1,
                kind: "program" as const,
                model: "older-model",
                text: "Already reviewed against an older plan.",
                generatedAt: new Date("2026-10-20T09:00:00Z"),
              },
            ],
          ]),
        ),
      save: (input) => {
        saved.push(input.activityId);
        return Promise.resolve({
          activityId: input.activityId,
          kind: input.kind ?? "general",
          model: input.model,
          text: input.text,
          generatedAt: new Date(),
        });
      },
    });

    expect(provider.requests).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it("reviews a stored review again when a newer comment has arrived", async () => {
    const provider = new FakeProvider();
    const saved: number[] = [];

    await analyzeActivitiesAgainstPlan({
      userId: 42,
      provider,
      apiKey: "test-key",
      model: "test-model",
      today: "2026-10-21",
      plan: makePlan(),
      activities: [makeActivity(1, "Morning Run")],
      activityComments: [
        {
          activityId: "1",
          comment: "Felt strong today.",
          updatedAt: "2026-10-21T09:00:00Z",
        },
      ],
      loadReviews: () =>
        Promise.resolve(
          new Map([
            [
              1,
              {
                activityId: 1,
                kind: "program" as const,
                model: "older-model",
                text: "Already reviewed.",
                generatedAt: new Date("2026-10-20T09:00:00Z"),
              },
            ],
          ]),
        ),
      save: (input) => {
        saved.push(input.activityId);
        return Promise.resolve({
          activityId: input.activityId,
          kind: input.kind ?? "general",
          model: input.model,
          text: input.text,
          generatedAt: new Date(),
        });
      },
    });

    expect(provider.requests).toHaveLength(1);
    expect(saved).toEqual([1]);
  });

  it("stores the body weight the athlete stated for the activity", async () => {
    const stored: unknown[] = [];

    await analyzeActivitiesAgainstPlan({
      userId: 42,
      provider: new JsonProvider({
        analysis: "A good easy run.",
        estimatedFtpWatts: null,
        weightKg: 88.4,
        bodyFatPercent: 22,
      }),
      apiKey: "test-key",
      model: "test-model",
      today: "2026-10-21",
      plan: makePlan(),
      activities: [makeActivity(1, "Morning Run")],
      activityComments: [
        { activityId: "1", comment: "Weighed 88.4 kg at 22 % this morning." },
      ],
      loadReviews: () => Promise.resolve(new Map()),
      save: (input) =>
        Promise.resolve({
          activityId: input.activityId,
          kind: input.kind ?? "general",
          model: input.model,
          text: input.text,
          generatedAt: new Date(),
        }),
      saveBodyMetrics: (userId, points) => {
        stored.push({ userId, points });
        return Promise.resolve();
      },
    });

    expect(stored).toEqual([
      {
        userId: 42,
        points: [{ date: "2026-10-19", weightKg: 88.4, bodyFatPercent: 22 }],
      },
    ]);
  });

  it("continues when one review fails", async () => {
    const saved: number[] = [];

    await analyzeActivitiesAgainstPlan({
      userId: 42,
      provider: new FakeProvider("Evening Run"),
      apiKey: "test-key",
      model: "test-model",
      today: "2026-10-21",
      plan: makePlan(),
      activities: [
        makeActivity(1, "Morning Run"),
        makeActivity(2, "Evening Run"),
      ],
      activityComments: [],
      loadReviews: () => Promise.resolve(new Map()),
      save: (input) => {
        saved.push(input.activityId);
        return Promise.resolve({
          activityId: input.activityId,
          kind: input.kind ?? "general",
          model: input.model,
          text: input.text,
          generatedAt: new Date(),
        });
      },
    });

    expect(saved).toEqual([1]);
  });
});
