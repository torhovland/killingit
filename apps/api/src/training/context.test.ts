import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ManualActivityContext } from "../llm/activityContext.js";
import {
  makePlan,
  makeWeek,
  PLAN_TODAY,
  PLAN_WEEK_START,
} from "../testFixtures/plan.js";

const manualActivities: ManualActivityContext[] = [
  {
    id: 1,
    startDate: "2026-10-20",
    details: "An easy hour on the bike",
    estimatedTss: 40,
    updatedAt: "2026-10-20T09:00:00.000Z",
  },
  {
    id: 2,
    startDate: "2026-10-20",
    details: "A second short ride",
    estimatedTss: 20,
    updatedAt: "2026-10-20T17:00:00.000Z",
  },
  {
    id: 3,
    startDate: "2026-10-22",
    details: "A walk with no estimate yet",
    estimatedTss: null,
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
];

let coachingInputLoads = 0;
const thresholdCutoffs: string[] = [];

await mock.module("../plans/inputs.js", () => ({
  loadManualActivities: () => Promise.resolve(manualActivities),
  loadCoachingInputs: () => {
    coachingInputLoads += 1;
    throw new Error(
      "the training context must load only the manual activities",
    );
  },
}));

await mock.module("../metrics/store.js", () => ({
  loadThresholdHistoryForUser: (_userId: number, cutoff: string) => {
    thresholdCutoffs.push(cutoff);
    return Promise.resolve({ summaries: [], points: [], timelines: [] });
  },
}));

const { loadTrainingContext } = await import("./context.js");

afterAll(() => {
  mock.restore();
});

describe("loadTrainingContext", () => {
  beforeEach(() => {
    thresholdCutoffs.length = 0;
  });

  it("loads the manual activities and derives the load maps without the other coaching inputs", async () => {
    const week = makeWeek();
    const [firstSession] = week.sessions;
    if (firstSession === undefined) {
      throw new Error("the fixture week needs a first session");
    }
    const plan = makePlan({
      week: {
        ...week,
        sessions: [
          { ...firstSession, estimatedTss: 55 },
          ...week.sessions.slice(1),
        ],
      },
      nextWeek: null,
    });

    const context = await loadTrainingContext(1, plan, PLAN_TODAY);

    expect(context.manualActivities).toEqual(manualActivities);
    expect(context.manualTssByDate).toEqual(new Map([["2026-10-20", 60]]));
    expect(context.planTssByDate).toEqual(new Map([[PLAN_WEEK_START, 55]]));
    expect(coachingInputLoads).toBe(0);
  });

  it("cuts the threshold history at the caller's today, not the stored plan's day", async () => {
    const callerToday = "2026-10-25";

    const context = await loadTrainingContext(1, makePlan(), callerToday);

    expect(PLAN_TODAY).not.toBe(callerToday);
    expect(thresholdCutoffs).toEqual([callerToday]);
    expect(context.thresholds).toEqual([]);
  });

  it("uses the caller's today when there is no stored plan", async () => {
    const callerToday = "2026-10-25";

    await loadTrainingContext(1, undefined, callerToday);

    expect(thresholdCutoffs).toEqual([callerToday]);
  });
});
