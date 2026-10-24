import { describe, expect, it } from "bun:test";
import type { AnalyzedActivity, CoachPlan } from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
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
    const content = request.messages[1]?.content ?? "";
    if (this.failOn !== undefined && content.includes(this.failOn)) {
      return Promise.reject(new Error("review failed"));
    }
    return Promise.resolve("This fit the base block well.");
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
