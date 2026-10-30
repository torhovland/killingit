import { describe, expect, it } from "bun:test";
import type {
  AthleteMetricStatement,
  AthleteMetricsResult,
} from "@killingit/shared";
import type { LlmCompletionRequest, LlmProvider } from "../llm/openrouter.js";
import {
  buildAthleteMetricSource,
  syncAthleteMetrics,
  type AthleteMetricInputs,
} from "./athleteMetrics.js";

function inputs(
  overrides: Partial<AthleteMetricInputs> = {},
): AthleteMetricInputs {
  return {
    answers: [
      {
        prompt: "Performance numbers?",
        answer: "89,5 kg and 24,5 % body fat. FTP is around 220 W.",
        skipped: false,
        answeredAt: new Date("2026-10-25T08:00:00Z"),
      },
    ],
    activityComments: [
      {
        activityId: "1",
        comment: "Weighed 88.4 kg this morning.",
        updatedAt: "2026-10-26T07:00:00Z",
      },
    ],
    manualActivities: [],
    weeklyNote: null,
    weeklyNoteUpdatedAt: null,
    periodReviews: [],
    ...overrides,
  };
}

class FakeProvider implements LlmProvider {
  readonly id = "fake";
  readonly requests: LlmCompletionRequest[] = [];

  constructor(private readonly response: string | Error) {}

  listModels(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateKey(): Promise<void> {
    return Promise.resolve();
  }

  complete(request: LlmCompletionRequest): Promise<string> {
    this.requests.push(request);
    return this.response instanceof Error
      ? Promise.reject(this.response)
      : Promise.resolve(this.response);
  }
}

const credentials = { apiKey: "test-key", model: "test-model" };

describe("buildAthleteMetricSource", () => {
  it("dates each piece of text and lists the newest first", () => {
    const source = buildAthleteMetricSource(
      inputs({
        manualActivities: [
          {
            id: 3,
            startDate: "2026-10-24",
            details: "FTP test on the trainer: 245 W.",
            updatedAt: "2026-10-24T12:00:00Z",
          },
        ],
        weeklyNote: "Down to 87 kg.",
        weeklyNoteUpdatedAt: new Date("2026-10-27T19:00:00Z"),
      }),
      "2026-10-28",
    );

    expect(source.profileSavedAt).toBe("2026-10-25");
    expect(source.entries.map((entry) => entry.date)).toEqual([
      "2026-10-27",
      "2026-10-26",
      "2026-10-24",
    ]);
    expect(source.entries[2]).toEqual({
      date: "2026-10-24",
      label: "manual activity",
      text: "FTP test on the trainer: 245 W.",
    });
  });

  it("ignores text dated after today and empty text", () => {
    const source = buildAthleteMetricSource(
      inputs({
        activityComments: [
          {
            activityId: "1",
            comment: "A weigh-in from the future.",
            updatedAt: "2026-11-01T07:00:00Z",
          },
          {
            activityId: "2",
            comment: "   ",
            updatedAt: "2026-10-20T07:00:00Z",
          },
        ],
      }),
      "2026-10-28",
    );

    expect(source.entries).toEqual([]);
  });
});

describe("syncAthleteMetrics", () => {
  it("stores what the coach read as athlete measurements", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        statements: [
          {
            date: "2026-10-25",
            weightKg: 89.5,
            bodyFatPercent: 24.5,
            thresholds: [
              {
                sport: "cycling",
                measure: "ftp",
                label: "FTP",
                unit: "W",
                kind: "power",
                value: 220,
              },
            ],
          },
        ],
      }),
    );
    const saved: {
      userId: number;
      statements: AthleteMetricStatement[];
      today: string;
    }[] = [];

    await syncAthleteMetrics({
      userId: 42,
      today: "2026-10-28",
      source: buildAthleteMetricSource(inputs(), "2026-10-28"),
      provider,
      credentials,
      dependencies: {
        save: (userId, statements, today) => {
          saved.push({ userId, statements: [...statements], today });
          return Promise.resolve();
        },
      },
    });

    expect(saved).toEqual([
      {
        userId: 42,
        today: "2026-10-28",
        statements: [
          {
            date: "2026-10-25",
            weightKg: 89.5,
            bodyFatPercent: 24.5,
            thresholds: [
              {
                sport: "cycling",
                measure: "ftp",
                label: "FTP",
                unit: "W",
                kind: "power",
                value: 220,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps the newest statement for a date and drops future dates", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        statements: [
          { date: "2026-10-20", weightKg: 90 },
          { date: "2026-10-20", bodyFatPercent: 24 },
          { date: "2026-11-20", weightKg: 80 },
        ],
      }),
    );
    const saved: AthleteMetricStatement[][] = [];

    await syncAthleteMetrics({
      userId: 42,
      today: "2026-10-28",
      source: buildAthleteMetricSource(inputs(), "2026-10-28"),
      provider,
      credentials,
      dependencies: {
        save: (_userId, statements) => {
          saved.push([...statements]);
          return Promise.resolve();
        },
      },
    });

    expect(saved).toEqual([
      [
        {
          date: "2026-10-20",
          weightKg: 90,
          bodyFatPercent: 24,
          thresholds: [],
        },
      ],
    ]);
  });

  it("asks which sport an unspecified threshold belongs to and does not store it", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        statements: [
          {
            date: "2026-10-20",
            thresholds: [
              {
                sport: null,
                measure: "ftp",
                label: "FTP",
                unit: "W",
                kind: "power",
                value: 250,
              },
            ],
          },
        ],
      }),
    );
    const saved: AthleteMetricStatement[][] = [];
    const questions: string[] = [];

    await syncAthleteMetrics({
      userId: 42,
      today: "2026-10-28",
      source: buildAthleteMetricSource(inputs(), "2026-10-28"),
      provider,
      credentials,
      dependencies: {
        save: (_userId, statements) => {
          saved.push([...statements]);
          return Promise.resolve();
        },
        saveQuestions: ({ questions: asked }) => {
          questions.push(...asked);
          return Promise.resolve();
        },
      },
    });

    expect(questions).toEqual([
      "You mentioned FTP 250 W. Which sport is that threshold for?",
    ]);
    expect(saved).toEqual([]);
  });

  it("keeps the stored measurements when the model fails", async () => {
    const provider = new FakeProvider(new Error("model unavailable"));
    const saved: AthleteMetricStatement[][] = [];

    const result = await syncAthleteMetrics({
      userId: 42,
      today: "2026-10-28",
      source: buildAthleteMetricSource(inputs(), "2026-10-28"),
      provider,
      credentials,
      dependencies: {
        save: (_userId, statements) => {
          saved.push([...statements]);
          return Promise.resolve();
        },
      },
    });

    expect(result).toBeNull();
    expect(saved).toEqual([]);
  });

  it("does not fail the caller when the write fails", async () => {
    const provider = new FakeProvider(
      JSON.stringify({ statements: [{ date: "2026-10-20", weightKg: 90 }] }),
    );

    const result = await syncAthleteMetrics({
      userId: 42,
      today: "2026-10-28",
      source: buildAthleteMetricSource(inputs(), "2026-10-28"),
      provider,
      credentials,
      dependencies: {
        save: () => Promise.reject(new Error("database down")),
      },
    });

    expect(result?.statements).toHaveLength(1);
  });

  it("skips the write when the athlete states nothing", async () => {
    const provider = new FakeProvider(JSON.stringify({ statements: [] }));
    let saved = false;

    const result: AthleteMetricsResult | null = await syncAthleteMetrics({
      userId: 42,
      today: "2026-10-28",
      source: buildAthleteMetricSource(inputs(), "2026-10-28"),
      provider,
      credentials,
      dependencies: {
        save: () => {
          saved = true;
          return Promise.resolve();
        },
      },
    });

    expect(saved).toBe(false);
    expect(result?.statements).toEqual([]);
  });
});
