import { describe, expect, it } from "bun:test";
import type { AthleteLocation } from "@killingit/shared";
import type { syncAthleteReading } from "../coaching/athleteReading.js";
import type { ActivityFeed } from "../coaching/feed/presenter.js";
import type { LlmClient } from "../llm/client.js";
import type { StoredAthleteQuestion } from "../questions/answers.js";
import type { CoachingSurveyAdjustmentStore } from "../questions/adjustments.js";
import {
  makeStoredPlan,
  MemoryGenerationStore,
  makePlan,
} from "../testFixtures/generationHarness.js";
import { makeAnalyzedActivity } from "../testFixtures/plan.js";
import { GenerationSupersededError } from "./generation.js";
import {
  buildPlanContext,
  syncAthleteReadingIfChanged,
  type LoadedPlanGenerationContext,
} from "./generationContext.js";
import type { CoachingInputs } from "./inputs.js";
import type { PlanInputs } from "./planInputs.js";

const emptyFeed: ActivityFeed = { model: null, activities: [] };

const emptyInputs: CoachingInputs = {
  manualActivities: [],
  activityComments: [],
  weeklyNote: null,
  weeklyNoteWeekStartDate: null,
  weeklyNoteReply: null,
  weeklyNoteUpdatedAt: null,
  periodReviews: [],
  weekReviewUpdatedAt: null,
  weekReviewNeedsRefresh: false,
  blockReviewUpdatedAt: null,
  blockReviewNeedsRefresh: false,
  updatedAt: null,
  refreshUpdatedAt: null,
};

const llm: LlmClient = {
  provider: {
    id: "test",
    listModels: () => Promise.resolve([]),
    validateKey: () => Promise.resolve(),
    complete: () => Promise.resolve(""),
  },
  apiKey: "test-key",
  seasonModel: "test-model",
  dailyModel: "test-model",
};

const user = {
  id: 242,
  sub: "test|242",
  role: "member" as const,
  timezone: "Europe/Oslo",
  location: null,
  dietAdvice: true,
  createdAt: new Date("2026-11-12T00:00:00Z"),
};

const location: AthleteLocation = {
  latitude: 59.91,
  longitude: 10.75,
  name: "Oslo",
};

const surveyAdjustmentStore: CoachingSurveyAdjustmentStore = {
  listForUser: () => Promise.resolve([]),
  append: () => Promise.resolve(),
  clearConsumed: () => Promise.resolve(),
};

const answer: StoredAthleteQuestion = {
  id: 1,
  versionId: 1,
  prompt: "What is your goal?",
  required: true,
  version: 1,
  versionCount: 1,
  createdAt: new Date("2026-10-20T09:00:00Z"),
  updatedAt: new Date("2026-10-20T09:00:00Z"),
  answer: "Run a marathon.",
  skipped: false,
  answeredAt: new Date("2026-11-01T09:00:00Z"),
  previous: null,
};

/** The required inputs a run loads before it assembles its context. */
function loadedContext(
  overrides: Partial<LoadedPlanGenerationContext> = {},
): LoadedPlanGenerationContext {
  return {
    plan: null,
    answers: [],
    activities: emptyFeed,
    llm,
    coachingInputs: emptyInputs,
    user,
    coachAnswers: [],
    surveyAdjustments: [],
    surveyAdjustmentStore,
    activitiesSnapshotAt: 1,
    ...overrides,
  };
}

const emptyPlanInputs: PlanInputs = {
  events: [],
  diet: null,
  calorieHistory: undefined,
  thresholdHistory: { points: [], timelines: [], summaries: [] },
  bodyHistory: { weight: [], bodyFat: [] },
  dailyHealth: undefined,
  weatherForecasts: null,
  forecast: null,
};

describe("buildPlanContext", () => {
  it("assembles the prompt context from the loaded and advisory inputs", () => {
    const activities = [
      makeAnalyzedActivity({
        analysis: {
          text: "Solid ride.",
          model: "test-model",
          generatedAt: "2026-11-11T06:00:00.000Z",
          planChangeNeeded: true,
        },
      }),
    ];
    const coachingInputs: CoachingInputs = {
      ...emptyInputs,
      weeklyNote: "Big week ahead.",
      weeklyNoteWeekStartDate: "2026-11-09",
      weeklyNoteReply: "Keep it steady.",
      weeklyNoteUpdatedAt: new Date("2026-11-10T09:00:00Z"),
      weekReviewUpdatedAt: new Date("2026-11-08T09:00:00Z"),
      weekReviewNeedsRefresh: true,
      blockReviewUpdatedAt: new Date("2026-11-01T09:00:00Z"),
      updatedAt: new Date("2026-11-10T09:00:00Z"),
      refreshUpdatedAt: new Date("2026-11-10T08:00:00Z"),
    };
    const inputs: PlanInputs = {
      ...emptyPlanInputs,
      events: [
        {
          startDate: "2026-12-01",
          endDate: null,
          title: "Oslo Marathon",
          kind: "race",
        },
      ],
      diet: { meals: [], weeks: [] },
      calorieHistory: [{ date: "2026-11-10", caloriesKcal: 2600 }],
      dailyHealth: [],
    };
    const signal = new AbortController().signal;

    const context = buildPlanContext({
      loaded: loadedContext({
        plan: makeStoredPlan(makePlan(), new Date("2026-11-01T09:00:00Z")),
        answers: [answer],
        coachingInputs,
      }),
      activities,
      recentActivities: activities,
      inputs,
      timeZone: "Europe/Oslo",
      location,
      signal,
    });

    expect(context).toEqual({
      answers: [answer],
      answersUpdatedAt: new Date("2026-11-01T09:00:00Z"),
      activities,
      recentActivities: activities,
      manualActivities: [],
      activityComments: [],
      weeklyNote: "Big week ahead.",
      weeklyNoteWeekStartDate: "2026-11-09",
      weeklyNoteReply: "Keep it steady.",
      weeklyNoteUpdatedAt: new Date("2026-11-10T09:00:00Z"),
      periodReviews: [],
      weekReviewUpdatedAt: new Date("2026-11-08T09:00:00Z"),
      blockReviewUpdatedAt: new Date("2026-11-01T09:00:00Z"),
      coachingInputsUpdatedAt: new Date("2026-11-10T09:00:00Z"),
      coachingInputsRefreshUpdatedAt: new Date("2026-11-10T08:00:00Z"),
      weekReviewNeedsRefresh: true,
      blockReviewNeedsRefresh: false,
      coachingSurveyAdjustments: [],
      activitiesUpdatedAt: new Date("2026-11-11T06:00:00Z"),
      activitiesRefreshUpdatedAt: new Date("2026-11-11T06:00:00Z"),
      timeZone: "Europe/Oslo",
      location,
      forecast: null,
      weatherForecasts: null,
      ftpHistory: [],
      thresholds: [],
      thresholdTimelines: [],
      bodyHistory: { weight: [], bodyFat: [] },
      dailyHealth: [],
      events: inputs.events,
      diet: { meals: [], weeks: [] },
      dietGoal: null,
      dietAdvice: true,
      calorieHistory: [{ date: "2026-11-10", caloriesKcal: 2600 }],
      provider: llm.provider,
      apiKey: "test-key",
      seasonModel: "test-model",
      dailyModel: "test-model",
      signal,
    });
  });

  it("keeps the full activity history for the load and the recent window for prompts", () => {
    const newest = makeAnalyzedActivity();
    const oldest = makeAnalyzedActivity({ id: 2 });

    const context = buildPlanContext({
      loaded: loadedContext(),
      activities: [newest, oldest],
      recentActivities: [newest],
      inputs: emptyPlanInputs,
      timeZone: null,
      location: null,
      signal: new AbortController().signal,
    });

    expect(context.activities).toEqual([newest, oldest]);
    expect(context.recentActivities).toEqual([newest]);
  });

  it("leaves the diet section out when no diet was read", () => {
    const context = buildPlanContext({
      loaded: loadedContext(),
      activities: [],
      recentActivities: [],
      inputs: emptyPlanInputs,
      timeZone: null,
      location: null,
      signal: new AbortController().signal,
    });

    expect(context.diet).toBeUndefined();
    expect(context.ftpHistory).toEqual([]);
  });
});

describe("syncAthleteReadingIfChanged", () => {
  const run = {
    userId: 242,
    today: "2026-11-12",
    runId: "run-1",
    signal: new AbortController().signal,
  };

  it("reads the athlete's text and fences the run afterwards", async () => {
    const generations = new MemoryGenerationStore();
    await generations.begin(run.userId, run.runId);
    const order: string[] = [];
    const isCurrent = generations.isCurrent.bind(generations);
    generations.isCurrent = (userId, runId) => {
      order.push("fence");
      return isCurrent(userId, runId);
    };
    const reads: Parameters<typeof syncAthleteReading>[0][] = [];

    await syncAthleteReadingIfChanged(
      {
        generations,
        syncAthleteReading: (input) => {
          order.push("read");
          reads.push(input);
          return Promise.resolve(null);
        },
      },
      loadedContext({
        coachingInputs: {
          ...emptyInputs,
          weeklyNotes: [
            {
              weekStartDate: "2026-11-09",
              note: "Race next week.",
              updatedAt: new Date("2026-11-10T09:00:00Z"),
            },
          ],
        },
      }),
      run,
    );

    expect(order).toEqual(["read", "fence"]);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.userId).toBe(run.userId);
    expect(reads[0]?.today).toBe(run.today);
    expect(reads[0]?.provider).toBe(llm.provider);
    expect(reads[0]?.credentials).toEqual({
      apiKey: "test-key",
      model: "test-model",
      signal: run.signal,
    });
    expect(reads[0]?.source.entries).toEqual([
      { date: "2026-11-09", label: "weekly note", text: "Race next week." },
    ]);
  });

  it("skips the reading when the stored plan already read the text", async () => {
    const generations = new MemoryGenerationStore();
    await generations.begin(run.userId, run.runId);
    let reads = 0;
    let fences = 0;
    const isCurrent = generations.isCurrent.bind(generations);
    generations.isCurrent = (userId, runId) => {
      fences += 1;
      return isCurrent(userId, runId);
    };

    await syncAthleteReadingIfChanged(
      {
        generations,
        syncAthleteReading: () => {
          reads += 1;
          return Promise.resolve(null);
        },
      },
      loadedContext({
        plan: makeStoredPlan(makePlan(), new Date("2026-11-02T09:00:00Z")),
        answers: [answer],
      }),
      run,
    );

    expect(reads).toBe(0);
    expect(fences).toBe(0);
  });

  it("stops when the run was aborted while the reading ran", async () => {
    const controller = new AbortController();
    const generations = new MemoryGenerationStore();
    await generations.begin(run.userId, run.runId);

    const failure = await syncAthleteReadingIfChanged(
      {
        generations,
        syncAthleteReading: () => {
          controller.abort();
          return Promise.resolve(null);
        },
      },
      loadedContext(),
      { ...run, signal: controller.signal },
    ).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(GenerationSupersededError);
  });

  it("stops when a newer run owns the generation row", async () => {
    const generations = new MemoryGenerationStore();
    await generations.begin(run.userId, run.runId);
    generations.isCurrent = () => Promise.resolve(false);

    const failure = await syncAthleteReadingIfChanged(
      {
        generations,
        syncAthleteReading: () => Promise.resolve(null),
      },
      loadedContext(),
      run,
    ).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(GenerationSupersededError);
  });
});
