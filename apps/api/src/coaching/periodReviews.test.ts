import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
import { captureCompletedPeriodReviews } from "./periodReviews.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Run a marathon",
      startDate: "2026-09-01",
      endDate: "2027-04-01",
      rationale: "Build a base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-09-01",
          endDate: "2026-10-01",
          weekCount: 4,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Consistent volume.",
      startDate: "2026-09-01",
      endDate: "2026-10-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-09-07",
          focus: "Aerobic",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-09-07",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-09-${String(7 + index).padStart(2, "0")}`,
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
      date: "2026-10-02",
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

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  requests: LlmCompletionRequest[] = [];

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return Promise.resolve("A consistent block with good aerobic work.");
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    userId: 1,
    today: "2026-10-02",
    plan: makePlan(),
    provider: new FakeProvider(),
    apiKey: "test-key",
    model: "test-model",
    athleteAnswers: [],
    activities: [],
    manualActivities: [],
    activityComments: [],
    weeklyNote: null,
    save: () => Promise.resolve(),
    load: () => Promise.resolve(null),
    ...overrides,
  };
}

describe("captureCompletedPeriodReviews", () => {
  it("summarises the completed week and block", async () => {
    const saved: Array<{ kind: string; startDate: string; title: string }> = [];
    await captureCompletedPeriodReviews(
      input({
        save: (entry: { kind: string; startDate: string; title: string }) => {
          saved.push(entry);
          return Promise.resolve();
        },
      }),
    );

    expect(saved.map((entry) => entry.kind).sort()).toEqual(["block", "week"]);
    expect(saved.find((entry) => entry.kind === "week")?.startDate).toBe(
      "2026-09-07",
    );
  });

  it("does not regenerate a review that already exists", async () => {
    const provider = new FakeProvider();
    const saved: unknown[] = [];
    await captureCompletedPeriodReviews(
      input({
        provider,
        load: (_userId: number, kind: string) =>
          Promise.resolve(
            kind === "week"
              ? {
                  kind: "week" as const,
                  startDate: "2026-09-07",
                  endDate: "2026-09-13",
                  title: "Existing",
                  summary: "Existing summary",
                  model: "test-model",
                  promptVersion: 1,
                  comment: null,
                  reviewed: false,
                  generatedAt: new Date(),
                  updatedAt: new Date(),
                }
              : null,
          ),
        save: (entry: unknown) => {
          saved.push(entry);
          return Promise.resolve();
        },
      }),
    );

    // The week exists, so only the block is generated.
    expect(provider.requests).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it("leaves a current week and block alone", async () => {
    const provider = new FakeProvider();
    const saved: unknown[] = [];
    await captureCompletedPeriodReviews(
      input({
        today: "2026-09-10",
        provider,
        save: (entry: unknown) => {
          saved.push(entry);
          return Promise.resolve();
        },
      }),
    );

    expect(provider.requests).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });
});
