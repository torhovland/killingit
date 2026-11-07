import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  CoachPlan,
  DayPlan,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "./openrouter.js";
import { generateDailyUpdate, generatePlanUpdate } from "./planUpdate.js";
import type { DailyUpdateInput, PlanUpdateInput } from "./planUpdatePrompt.js";

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  requests: LlmCompletionRequest[] = [];

  constructor(private readonly responses: string[]) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return Promise.resolve(this.responses[this.requests.length - 1] ?? "");
  }
}

const season: SeasonPlan = {
  goal: "Sub-4-hour marathon",
  startDate: "2026-10-21",
  endDate: "2027-04-01",
  rationale: "Build aerobic base.",
  blocks: [
    {
      name: "Base",
      focus: "Aerobic endurance",
      startDate: "2026-10-21",
      endDate: "2026-12-01",
      weekCount: 6,
    },
  ],
};

const block: BlockPlan = {
  name: "Base",
  focus: "Aerobic endurance",
  rationale: "Build consistent volume.",
  startDate: "2026-10-21",
  endDate: "2026-12-01",
  weeks: [
    {
      number: 1,
      startDate: "2026-10-19",
      focus: "Aerobic base",
      targetLoad: "Easy",
    },
  ],
};

function week(dates: string[]): WeekPlan {
  return {
    startDate: "2026-10-19",
    focus: "Aerobic base",
    rationale: "Keep the week easy.",
    sessions: dates.map((date) => ({
      date,
      day: "Monday",
      type: "workout" as const,
      title: "Easy run",
      description: "Easy aerobic work.",
      durationMinutes: 45,
      intensity: "easy" as const,
      status: "planned" as const,
    })),
  };
}

function day(date: string) {
  return {
    date,
    type: "workout" as const,
    title: "Easy run",
    description: "Easy aerobic work.",
    durationMinutes: 45,
    intensity: "easy" as const,
    alternatives: [],
    rationale: "Easy aerobic work.",
    optional: false,
    status: "planned" as const,
  };
}

function planUpdateInput(): PlanUpdateInput {
  return {
    ...input(),
    todayPlan: day("2026-10-21"),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    revision: {
      season: false,
      block: false,
      week: true,
      day: true,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      progress: false,
    },
  };
}

function planUpdateResponse(overrides: Partial<CoachPlan> = {}): string {
  const weekPlan = input().week;
  const todayPlan: DayPlan = day("2026-10-21");
  return JSON.stringify({
    season,
    block,
    week: weekPlan,
    today: todayPlan,
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    bodyMetrics: [],
    ...overrides,
  });
}

function input(): DailyUpdateInput {
  return {
    today: "2026-10-21",
    timezone: "Europe/Oslo",
    athleteAnswers: [],
    recentActivities: [],
    season,
    block,
    week: week([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]),
  };
}

describe("generateDailyUpdate", () => {
  it("repairs a response whose today date is missing from the week", async () => {
    const badWeek = week([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    // The response is valid on its own, but the current day is not the date
    // required by the caller, so it must be sent back for repair.
    const schemaOnlyFailure = {
      today: day("2026-10-26"),
      week: badWeek,
    };
    const corrected = {
      today: day("2026-10-21"),
      tomorrow: null,
      week: badWeek,
    };
    const provider = new FakeProvider([
      JSON.stringify(schemaOnlyFailure),
      JSON.stringify(corrected),
    ]);

    const result = await generateDailyUpdate(
      provider,
      { apiKey: "key", model: "model" },
      input(),
    );

    expect(result.today.date).toBe("2026-10-21");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.kind).toBe("daily_update");
    expect(provider.requests[1]?.kind).toBe("daily_update");
    expect(provider.requests[1]?.metadata).toMatchObject({ repair: true });
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      'The "today" object\'s date must be exactly 2026-10-21',
    );
  });
});

describe("generatePlanUpdate", () => {
  it("returns the complete plan from one completion", async () => {
    const provider = new FakeProvider([planUpdateResponse()]);

    const result = await generatePlanUpdate(
      provider,
      { apiKey: "key", model: "model" },
      planUpdateInput(),
    );

    expect(result.week.startDate).toBe("2026-10-19");
    expect(result.today.date).toBe("2026-10-21");
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.kind).toBe("plan_update");
  });

  it("repairs a plan that is missing a stated diet goal's progress targets", async () => {
    const progress = {
      targetWeightKg: 80,
      targetBodyFatPercent: 20,
      note: "On target.",
    };
    const corrected = planUpdateResponse({
      season: {
        ...season,
        dietProgress: progress,
        blocks: season.blocks.map((entry) => ({
          ...entry,
          dietProgress: progress,
        })),
      },
      block: {
        ...block,
        dietProgress: progress,
        weeks: block.weeks.map((entry) => ({
          ...entry,
          dietProgress: progress,
        })),
      },
      week: { ...input().week, dietProgress: progress },
      diet: {
        goal: "Lose 3 kg by March",
        goalProvided: true,
        assessment: "On target.",
      },
    });
    const provider = new FakeProvider([
      planUpdateResponse({
        diet: {
          goal: "Lose 3 kg by March",
          goalProvided: true,
          assessment: "On target.",
        },
      }),
      corrected,
    ]);

    const updateInput: PlanUpdateInput = {
      ...planUpdateInput(),
      dietAdvice: true,
      dietGoal: {
        goal: "Lose 3 kg by March",
        goalProvided: true,
        assessment: "On target.",
      },
    };
    const result = await generatePlanUpdate(
      provider,
      { apiKey: "key", model: "model" },
      updateInput,
    );

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.metadata).toMatchObject({ repair: true });
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      "Missing the diet progress target for the season",
    );
    expect(result.season.dietProgress?.targetWeightKg).toBe(80);
    expect(result.block.weeks[0]?.dietProgress?.targetWeightKg).toBe(80);
    expect(result.week.dietProgress?.targetWeightKg).toBe(80);
  });

  it("repairs a season target that does not reach the stated goal", async () => {
    const target = (fatPercent: number) => ({
      targetWeightKg: null,
      targetBodyFatPercent: fatPercent,
      note: "On target.",
    });
    const withGoal = (fatPercent: number) =>
      planUpdateResponse({
        season: {
          ...season,
          dietProgress: target(fatPercent),
          blocks: season.blocks.map((entry) => ({
            ...entry,
            dietProgress: target(fatPercent),
          })),
        },
        block: {
          ...block,
          dietProgress: target(fatPercent),
          weeks: block.weeks.map((entry) => ({
            ...entry,
            dietProgress: target(fatPercent),
          })),
        },
        week: { ...input().week, dietProgress: target(fatPercent) },
        diet: {
          goal: "Lose fat gradually toward 15% body fat",
          goalProvided: true,
          goalWeightKg: null,
          goalBodyFatPercent: 15,
          goalDate: null,
          assessment: "On target.",
        },
      });
    const provider = new FakeProvider([withGoal(20), withGoal(15)]);

    const result = await generatePlanUpdate(
      provider,
      { apiKey: "key", model: "model" },
      {
        ...planUpdateInput(),
        dietAdvice: true,
        dietGoal: {
          goal: "Lose fat gradually toward 15% body fat",
          goalProvided: true,
          goalWeightKg: null,
          goalBodyFatPercent: 15,
          goalDate: null,
          assessment: "On target.",
        },
      },
    );

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.metadata).toMatchObject({ repair: true });
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      "does not reach the athlete's goal of 15 % body fat",
    );
    expect(result.season.dietProgress?.targetBodyFatPercent).toBe(15);
  });

  it("repairs a next week that does not start on Monday", async () => {
    const provider = new FakeProvider([
      planUpdateResponse({
        nextWeek: {
          ...input().week,
          startDate: "2026-10-27",
        },
      }),
      planUpdateResponse(),
    ]);

    const result = await generatePlanUpdate(
      provider,
      { apiKey: "key", model: "model" },
      {
        ...planUpdateInput(),
        revision: { ...planUpdateInput().revision, nextWeek: true },
      },
    );

    expect(result.nextWeek).toBeNull();
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.metadata).toMatchObject({ repair: true });
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      "The next week must start on 2026-10-19",
    );
  });
});
