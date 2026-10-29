import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
import type { PlanContextInput } from "../llm/planContext.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import type { PlanStore, StoredPlan } from "../plans/store.js";
import {
  answerCoachingQuestion,
  replyToCoachQuestion,
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
    nextWeek: null,
    nextBlock: null,
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

const context: PlanContextInput = {
  today: "2026-10-21",
  athleteAnswers: [{ prompt: "Goal?", answer: "Marathon", skipped: false }],
  recentActivities: [
    {
      summary: {
        id: 1,
        name: "Morning Run",
        type: "running",
        startDate: "2026-10-20T06:30:00Z",
        distance: 10200,
        movingTime: 2700,
        elapsedTime: 2800,
        totalElevationGain: 120,
      },
      analysis: "Steady aerobic effort.",
    },
  ],
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

function deps(
  provider: FakeProvider,
  overrides: Partial<CoachReplyDependencies> = {},
): CoachReplyDependencies {
  return {
    plans: planStore(storedPlan()),
    answers,
    loadLlm: llm(provider),
    loadContext: () => Promise.resolve(context),
    ...overrides,
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
      deps(provider, {
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
      }),
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

  it("shows the athlete's recent training in the reply prompt", async () => {
    const provider = new FakeProvider();

    await replyToCoachingInput(deps(provider), {
      userId: 42,
      today: "2026-10-21",
      request: {
        kind: "weekly_note",
        weekStartDate: "2026-10-19",
        note: "No Thursday training.",
      },
    });

    const prompt = provider.requests[0]?.messages[1]?.content ?? "";
    expect(prompt).toContain("Recent activities (most recent first).");
    expect(prompt).toContain("Morning Run");
    expect(prompt).toContain("Coach analysis: Steady aerobic effort.");
  });

  it("dates the athlete profile from the newest answer", async () => {
    const provider = new FakeProvider();
    const seen: PlanContextInput[] = [];

    await replyToCoachingInput(
      deps(provider, {
        loadContext: (input) => {
          const built: PlanContextInput = {
            ...context,
            today: input.today,
            athleteAnswers: input.athleteAnswers,
          };
          seen.push(built);
          return Promise.resolve(built);
        },
      }),
      {
        userId: 42,
        today: "2026-10-21",
        request: {
          kind: "weekly_note",
          weekStartDate: "2026-10-19",
          note: "No Thursday training.",
        },
      },
    );

    expect(seen[0]?.today).toBe("2026-10-21");
    expect(seen[0]?.athleteAnswers[0]?.answeredAt).toEqual(
      new Date("2026-10-20T10:00:00Z"),
    );
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Athlete profile (answers last saved 2026-10-20)",
    );
  });

  it("targets the manual activity id and the week start date", async () => {
    const targets: string[] = [];
    const provider = new FakeProvider();
    const store = deps(provider, {
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
    });

    await replyToCoachingInput(store, {
      userId: 42,
      today: "2026-10-21",
      request: {
        kind: "manual_activity",
        manualActivityId: 7,
        startDate: "2026-10-21",
        details: "Pool swim",
      },
    });
    await replyToCoachingInput(store, {
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
      deps(provider, { plans: planStore(null) }),
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
      deps(new FakeProvider(new Error("provider down"))),
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

  it("does not call the model when the reply context cannot be loaded", async () => {
    const provider = new FakeProvider();

    const result = await replyToCoachingInput(
      deps(provider, {
        loadContext: () => Promise.reject(new Error("database down")),
      }),
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
});

describe("replyToCoachQuestion", () => {
  it("shows the recent training when replying to an answer", async () => {
    const provider = new FakeProvider();

    const answer = await replyToCoachQuestion(deps(provider), {
      userId: 42,
      today: "2026-10-21",
      question: "Was the power data recorded with a power meter?",
      answer: "Yes, a crank-based meter.",
    });

    expect(answer?.text).toBe("Keep Thursday easy.");
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Recent activities (most recent first).",
    );
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      'Athlete answer: "Yes, a crank-based meter."',
    );
  });
});

describe("answerCoachingQuestion", () => {
  it("answers a one-off question with the recent training in the prompt", async () => {
    const provider = new FakeProvider();

    const answer = await answerCoachingQuestion(deps(provider), {
      userId: 42,
      today: "2026-10-21",
      question: "Should I ride today?",
    });

    expect(answer?.text).toBe("Keep Thursday easy.");
    const prompt = provider.requests[0]?.messages[1]?.content ?? "";
    expect(prompt).toContain('Question: "Should I ride today?"');
    expect(prompt).toContain("Recent activities (most recent first).");
  });
});
