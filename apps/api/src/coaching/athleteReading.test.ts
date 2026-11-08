import { describe, expect, it } from "bun:test";
import type { AthleteReadingResult } from "@killingit/shared";
import type { LlmProvider } from "../llm/openrouter.js";
import {
  buildAthleteReadingSource,
  syncAthleteReading,
  type AthleteReadingInputs,
} from "./athleteReading.js";

const provider = {} as LlmProvider;
const credentials = { apiKey: "key", model: "test/model" };

function inputs(overrides: Partial<AthleteReadingInputs> = {}) {
  return {
    answers: [
      {
        prompt: "What are you training for?",
        answer: "The Oslo Marathon.",
        skipped: false,
        answeredAt: new Date("2026-11-01T09:00:00Z"),
      },
    ],
    activityComments: [
      {
        activityId: "1",
        comment: "Weighed 88.4 kg.",
        updatedAt: "2026-10-30T09:00:00Z",
      },
    ],
    manualActivities: [
      {
        id: 1,
        startDate: "2026-10-29",
        details: "Easy hike.",
        updatedAt: "2026-10-29T09:00:00Z",
      },
    ],
    weeklyNotes: [
      {
        weekStartDate: "2026-10-27",
        note: "Training camp from 2 to 5 November.",
        updatedAt: new Date("2026-10-27T09:00:00Z"),
      },
    ],
    periodReviews: [
      {
        kind: "week" as const,
        title: "Week 1",
        startDate: "2026-10-20",
        endDate: "2026-10-26",
        summary: "A solid week.",
        comment: "Felt strong.",
        reply: null,
        weeklyNote: null,
        updatedAt: "2026-10-27T09:00:00Z",
      },
    ],
    coachQuestionAnswers: [
      {
        question: "Which sport is that threshold for?",
        answer: "Cycling.",
        answeredAt: new Date("2026-11-02T09:00:00Z"),
      },
    ],
    ...overrides,
  };
}

describe("buildAthleteReadingSource", () => {
  it("collects every dated statement the coach reads", () => {
    const source = buildAthleteReadingSource(inputs(), "2026-11-04");

    expect(source.profileSavedAt).toBe("2026-11-01");
    expect(source.today).toBe("2026-11-04");
    const labels = source.entries.map((entry) => entry.label);
    expect(labels).toContain("activity comment");
    expect(labels).toContain("manual activity");
    expect(labels).toContain("weekly note");
    expect(labels).toContain("week review comment");
    expect(labels).toContain(
      'answer to coach question "Which sport is that threshold for?"',
    );
    expect(source.entries[0]?.date).toBe("2026-11-02");
  });

  it("drops statements dated after today", () => {
    const source = buildAthleteReadingSource(
      inputs({
        activityComments: [
          {
            activityId: "1",
            comment: "A future note.",
            updatedAt: "2026-12-01T09:00:00Z",
          },
        ],
      }),
      "2026-11-04",
    );

    expect(
      source.entries.some((entry) => entry.text === "A future note."),
    ).toBe(false);
  });
});

describe("syncAthleteReading", () => {
  it("stores measurements and events from one reading", async () => {
    const result: AthleteReadingResult = {
      statements: [
        {
          date: "2026-10-30",
          weightKg: 88.4,
          bodyFatPercent: null,
          thresholds: [],
        },
        {
          date: "2026-11-01",
          weightKg: null,
          bodyFatPercent: null,
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
        {
          date: "2026-12-01",
          weightKg: 80,
          bodyFatPercent: null,
          thresholds: [],
        },
      ],
      events: [
        {
          startDate: "2027-03-14",
          endDate: null,
          title: "Oslo Marathon",
          kind: "race",
        },
        {
          startDate: "2026-10-01",
          endDate: null,
          title: "Past race",
          kind: "race",
        },
      ],
      coachQuestion: "How did the marathon go?",
      modelsRemarks: null,
    };
    const savedMetrics: unknown[] = [];
    const savedEvents: unknown[] = [];
    const questions: unknown[] = [];

    const value = await syncAthleteReading({
      userId: 42,
      today: "2026-11-04",
      source: buildAthleteReadingSource(inputs(), "2026-11-04"),
      provider,
      credentials,
      dependencies: {
        extract: () => Promise.resolve(result),
        saveMetrics: (userId, statements) => {
          savedMetrics.push({ userId, statements });
          return Promise.resolve();
        },
        saveEvents: (userId, events) => {
          savedEvents.push({ userId, events });
          return Promise.resolve();
        },
        saveQuestions: (input) => {
          questions.push(input);
          return Promise.resolve();
        },
      },
    });

    expect(value).toEqual(result);
    expect(savedMetrics).toEqual([
      {
        userId: 42,
        statements: [
          {
            date: "2026-10-30",
            weightKg: 88.4,
            bodyFatPercent: null,
            thresholds: [],
          },
          {
            date: "2026-11-01",
            weightKg: null,
            bodyFatPercent: null,
            thresholds: [],
          },
        ],
      },
    ]);
    expect(savedEvents).toEqual([
      {
        userId: 42,
        events: [
          {
            startDate: "2027-03-14",
            endDate: null,
            title: "Oslo Marathon",
            kind: "race",
          },
        ],
      },
    ]);
    expect(questions).toHaveLength(2);
  });

  it("keeps everything when the reading fails", async () => {
    const savedMetrics: unknown[] = [];
    const savedEvents: unknown[] = [];

    const value = await syncAthleteReading({
      userId: 42,
      today: "2026-11-04",
      source: buildAthleteReadingSource(inputs(), "2026-11-04"),
      provider,
      credentials,
      dependencies: {
        extract: () => Promise.reject(new Error("model unavailable")),
        saveMetrics: (userId, statements) => {
          savedMetrics.push({ userId, statements });
          return Promise.resolve();
        },
        saveEvents: (userId, events) => {
          savedEvents.push({ userId, events });
          return Promise.resolve();
        },
      },
    });

    expect(value).toBeNull();
    expect(savedMetrics).toHaveLength(0);
    expect(savedEvents).toHaveLength(0);
  });
});
