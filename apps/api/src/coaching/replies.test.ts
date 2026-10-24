import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import {
  replyToCoachingInput,
  type CoachReplyDependencies,
} from "./replies.js";

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

function storedPlan(): StoredPlan {
  return {
    plan: makePlan(),
    answersUpdatedAt: new Date("2026-10-20T10:00:00Z"),
    coachingInputsUpdatedAt: null,
    activitiesUpdatedAt: null,
    generatedAt: new Date("2026-10-20T10:00:00Z"),
  };
}

const answers: QuestionAnswerStore = {
  listForUser: () =>
    Promise.resolve([
      {
        id: 1,
        versionId: 1,
        prompt: "Goal?",
        required: true,
        version: 1,
        versionCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        answer: "Marathon",
        skipped: false,
        answeredAt: new Date("2026-10-20T10:00:00Z"),
      },
    ]),
  saveAnswers: () => Promise.resolve(true),
};

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  requests: LlmCompletionRequest[] = [];

  constructor(private readonly reply: string | Error = "Keep Thursday easy.") {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return this.reply instanceof Error
      ? Promise.reject(this.reply)
      : Promise.resolve(this.reply);
  }
}

function llm(provider: FakeProvider, userIds?: number[]) {
  return (userId: number) => {
    userIds?.push(userId);
    return Promise.resolve({
      provider,
      apiKey: "test-key",
      model: "test-model",
    });
  };
}

function planStore(plan: StoredPlan | null): PlanStore {
  return {
    load: () => Promise.resolve(plan),
    save: () => Promise.reject(new Error("not used")),
  };
}

describe("replyToCoachingInput", () => {
  it("generates and stores a reply for an activity comment", async () => {
    const provider = new FakeProvider("Good work; I will keep Thursday easy.");
    const llmUserIds: number[] = [];
    const saved: {
      value: {
        userId: number;
        kind: string;
        target: string;
        reply: string;
        model: string;
      } | null;
    } = { value: null };

    const result = await replyToCoachingInput(
      {
        plans: planStore(storedPlan()),
        answers,
        loadLlm: llm(provider, llmUserIds),
        saveReply: (input) => {
          saved.value = input;
          return Promise.resolve({
            kind: input.kind,
            target: input.target,
            text: input.reply,
            model: input.model,
            generatedAt: new Date("2026-10-21T12:00:00Z"),
          });
        },
      },
      {
        userId: 42,
        today: "2026-10-21",
        request: {
          kind: "activity_comment",
          activityId: "123",
          activityDate: "2026-10-19",
          comment: "Felt strong on the hills.",
        },
      },
    );

    expect(saved.value).toEqual({
      userId: 42,
      kind: "activity_comment",
      target: "123",
      reply: "Good work; I will keep Thursday easy.",
      model: "test-model",
    });
    expect(result?.text).toBe("Good work; I will keep Thursday easy.");
    expect(llmUserIds).toEqual([42]);
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Felt strong on the hills.",
    );
  });

  it("targets the manual activity id and the week start date", async () => {
    const targets: string[] = [];
    const deps: CoachReplyDependencies = {
      plans: planStore(storedPlan()),
      answers,
      loadLlm: llm(new FakeProvider()),
      saveReply: (input) => {
        targets.push(input.target);
        return Promise.resolve({
          kind: input.kind,
          target: input.target,
          text: input.reply,
          model: input.model,
          generatedAt: new Date(),
        });
      },
    };

    await replyToCoachingInput(deps, {
      userId: 42,
      today: "2026-10-21",
      request: {
        kind: "manual_activity",
        manualActivityId: 7,
        startDate: "2026-10-21",
        details: "Pool swim",
      },
    });
    await replyToCoachingInput(deps, {
      userId: 42,
      today: "2026-10-21",
      request: {
        kind: "weekly_note",
        weekStartDate: "2026-10-19",
        note: "No Thursday training.",
      },
    });

    expect(targets).toEqual(["7", "2026-10-19"]);
  });

  it("does not call the model without a stored plan", async () => {
    const provider = new FakeProvider();

    const result = await replyToCoachingInput(
      {
        plans: planStore(null),
        answers,
        loadLlm: llm(provider),
      },
      {
        userId: 42,
        today: "2026-10-21",
        request: {
          kind: "weekly_note",
          weekStartDate: "2026-10-19",
          note: "x",
        },
      },
    );

    expect(result).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });

  it("returns null when the model call fails", async () => {
    const result = await replyToCoachingInput(
      {
        plans: planStore(storedPlan()),
        answers,
        loadLlm: llm(new FakeProvider(new Error("provider down"))),
      },
      {
        userId: 42,
        today: "2026-10-21",
        request: {
          kind: "weekly_note",
          weekStartDate: "2026-10-19",
          note: "x",
        },
      },
    );

    expect(result).toBeNull();
  });
});
