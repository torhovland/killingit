import { describe, expect, it } from "bun:test";
import type { BlockPlan, SeasonPlan, WeekPlan } from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "./openrouter.js";
import { generateDailyUpdate } from "./planUpdate.js";
import type { DailyUpdateInput } from "./planUpdatePrompt.js";

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
    status: "planned" as const,
  };
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
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      'The "today" object\'s date must be exactly 2026-10-21',
    );
  });
});
