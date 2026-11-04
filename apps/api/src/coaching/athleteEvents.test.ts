import { describe, expect, it } from "bun:test";
import type { AthleteEvent, AthleteEventsResult } from "@killingit/shared";
import {
  buildAthleteEventSource,
  normalizeEvents,
  syncAthleteEvents,
} from "./athleteEvents.js";

const today = "2026-11-04";

describe("buildAthleteEventSource", () => {
  it("dates every piece of athlete text and lists the newest first", () => {
    const source = buildAthleteEventSource(
      {
        answers: [
          {
            prompt: "What are you training for?",
            answer: "The Oslo Marathon on 14 March 2027.",
            skipped: false,
            answeredAt: "2026-11-01T09:00:00Z",
          },
        ],
        activityComments: [
          {
            activityId: "1",
            comment: "Great ride, next week is a training camp.",
            updatedAt: "2026-10-30T18:00:00Z",
          },
        ],
        manualActivities: [
          {
            id: 2,
            startDate: "2026-10-20",
            details: "Club ride",
            updatedAt: "2026-10-20T12:00:00Z",
          },
        ],
        weeklyNotes: [
          {
            weekStartDate: "2026-10-12",
            note: "Racing the city half on Sunday.",
            updatedAt: new Date("2026-10-14T19:00:00Z"),
          },
        ],
        periodReviews: [
          {
            kind: "week",
            title: "Week starting 2026-10-05",
            startDate: "2026-10-05",
            endDate: "2026-10-11",
            summary: "Solid week.",
            comment: "Felt strong.",
            reply: null,
            updatedAt: "2026-10-12T08:00:00Z",
          },
        ],
        coachQuestionAnswers: [
          {
            question: "Which sport is your FTP for?",
            answer: "Cycling. My A race is in June.",
            answeredAt: "2026-10-25T10:00:00Z",
          },
        ],
      },
      today,
    );

    expect(source.today).toBe(today);
    expect(source.profileSavedAt).toBe("2026-11-01");
    expect(source.entries.map((entry) => entry.label)).toEqual([
      "activity comment",
      'answer to coach question "Which sport is your FTP for?"',
      "manual activity",
      "weekly note",
      "week review comment",
    ]);
    expect(source.entries[0]?.date).toBe("2026-10-30");
    expect(source.entries.at(-1)?.date).toBe("2026-10-12");
  });

  it("skips blank and future-dated text", () => {
    const source = buildAthleteEventSource(
      {
        answers: [],
        activityComments: [
          {
            activityId: "1",
            comment: "   ",
            updatedAt: "2026-10-30T18:00:00Z",
          },
          {
            activityId: "2",
            comment: "A race tomorrow.",
            updatedAt: "2026-12-01T18:00:00Z",
          },
        ],
        manualActivities: [],
        weeklyNotes: [],
        periodReviews: [],
      },
      today,
    );

    expect(source.entries).toEqual([]);
  });
});

describe("normalizeEvents", () => {
  const events: AthleteEvent[] = [
    {
      startDate: "2027-03-14",
      endDate: null,
      title: "  Oslo Marathon ",
      kind: "race",
    },
    {
      startDate: "2026-10-01",
      endDate: null,
      title: "Finished race",
      kind: "race",
    },
    {
      startDate: "2026-11-02",
      endDate: "2026-11-05",
      title: "Training camp",
      kind: "trip",
    },
    {
      startDate: "2026-12-01",
      endDate: "2026-11-01",
      title: "Bad range",
      kind: "event",
    },
    {
      startDate: "2027-03-14",
      endDate: null,
      title: "Oslo Marathon",
      kind: "race",
    },
    {
      startDate: "2027-01-01",
      endDate: null,
      title: "   ",
      kind: "goal",
    },
  ];

  it("keeps future and ongoing events, trims titles, and drops past ones", () => {
    const normalized = normalizeEvents(events, today);

    expect(normalized.map((event) => event.title)).toEqual([
      "Training camp",
      "Bad range",
      "Oslo Marathon",
    ]);
  });

  it("turns an end date before the start into a one-day event", () => {
    const normalized = normalizeEvents(events, today);
    const badRange = normalized.find((event) => event.title === "Bad range");
    expect(badRange?.endDate).toBeNull();
  });
});

describe("syncAthleteEvents", () => {
  const source = {
    profile: [],
    profileSavedAt: null,
    entries: [],
    today,
  };

  function result(overrides: Partial<AthleteEventsResult> = {}) {
    return {
      events: [
        {
          startDate: "2027-03-14",
          endDate: null,
          title: "Oslo Marathon",
          kind: "race" as const,
        },
      ],
      ...overrides,
    };
  }

  function credentials() {
    return { apiKey: "key", model: "test/model" };
  }

  const provider = {
    id: "fake",
    listModels: () => Promise.resolve([]),
    validateKey: () => Promise.resolve(),
    complete: () => Promise.resolve("{}"),
  };

  it("stores the normalized events a successful reading returns", async () => {
    const saved: AthleteEvent[][] = [];
    await syncAthleteEvents({
      userId: 1,
      today,
      source,
      provider,
      credentials: credentials(),
      dependencies: {
        extract: () => Promise.resolve(result()),
        save: (_userId, events) => {
          saved.push([...events]);
          return Promise.resolve();
        },
        saveQuestions: () => Promise.resolve(),
      },
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.[0]?.title).toBe("Oslo Marathon");
  });

  it("stores a clarification question the reading returns", async () => {
    const questions: string[] = [];
    await syncAthleteEvents({
      userId: 1,
      today,
      source,
      provider,
      credentials: credentials(),
      dependencies: {
        extract: () =>
          Promise.resolve(result({ coachQuestion: "Which year is the race?" })),
        save: () => Promise.resolve(),
        saveQuestions: (input) => {
          questions.push(...input.questions);
          return Promise.resolve();
        },
      },
    });

    expect(questions).toEqual(["Which year is the race?"]);
  });

  it("leaves the stored events untouched when the reading fails", async () => {
    let saved = false;
    const value = await syncAthleteEvents({
      userId: 1,
      today,
      source,
      provider,
      credentials: credentials(),
      dependencies: {
        extract: () => Promise.reject(new Error("provider down")),
        save: () => {
          saved = true;
          return Promise.resolve();
        },
        saveQuestions: () => Promise.resolve(),
      },
    });

    expect(value).toBeNull();
    expect(saved).toBe(false);
  });
});
