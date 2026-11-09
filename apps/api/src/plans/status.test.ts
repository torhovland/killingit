import { describe, expect, it } from "bun:test";
import { addDays, type CoachPlan } from "@killingit/shared";
import {
  latestActivityAnalysisTimestamp,
  latestAnswerTimestamp,
  planIsStale,
  planPending,
} from "./status.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Marathon",
      startDate: "2026-10-21",
      endDate: "2027-04-01",
      rationale: "Build aerobic base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-21",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      rationale: "Establish consistent volume.",
      startDate: "2026-10-21",
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
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: `Session ${index + 1}`,
        description: "Easy.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    },
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
    },
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
  };
}

describe("planPending", () => {
  it("marks every level when there is no plan", () => {
    expect(planPending(null, "2026-10-21")).toEqual({
      initial: true,
      day: true,
      week: true,
      block: true,
      tomorrow: true,
      nextWeek: true,
      nextBlock: true,
      dietProgress: false,
    });
  });

  it("marks nothing when the plan covers today", () => {
    expect(planPending(makePlan(), "2026-10-21")).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
  });

  it("marks the day and week pending when a calorie target is implausibly low", () => {
    const plan = makePlan();
    plan.today = { ...plan.today, estimatedCaloriesKcal: 480 };
    expect(planPending(plan, "2026-10-21")).toMatchObject({
      day: true,
      week: true,
      block: false,
    });
  });

  it("marks the block pending when a new week review has arrived", () => {
    expect(planPending(makePlan(), "2026-10-21", false, false, true)).toEqual({
      initial: false,
      day: false,
      week: false,
      block: true,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
  });

  it("marks tomorrow when requested and it is missing", () => {
    expect(planPending(makePlan(), "2026-10-21", true)).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: true,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
  });

  it("does not mark tomorrow when the plan already has it", () => {
    const plan = makePlan();
    plan.tomorrow = {
      date: "2026-10-22",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      optionalRationale:
        "This easy run keeps the week consistent; skip it only if you feel unusually tired.",
      status: "planned",
    };
    expect(planPending(plan, "2026-10-21", true).tomorrow).toBe(false);
  });

  it("marks the day and week when the date moves on", () => {
    expect(planPending(makePlan(), "2026-10-22")).toEqual({
      initial: false,
      day: true,
      week: false,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
    expect(planPending(makePlan(), "2026-10-26")).toEqual({
      initial: false,
      day: true,
      week: true,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
  });

  it("marks the week pending when the weather forecast changed", () => {
    expect(planPending(makePlan(), "2026-10-21", false, true).week).toBe(true);
  });

  it("marks the week pending when today's result is not on the week", () => {
    const plan = makePlan();
    plan.today = { ...plan.today, status: "completed" };

    expect(planPending(plan, "2026-10-21").week).toBe(true);
  });

  it("does not mark the week pending when today's result matches", () => {
    const plan = makePlan();
    plan.today = { ...plan.today, status: "partial" };
    plan.week = {
      ...plan.week,
      sessions: plan.week.sessions.map((session) =>
        session.date === "2026-10-21"
          ? { ...session, status: "partial" }
          : session,
      ),
    };

    expect(planPending(plan, "2026-10-21").week).toBe(false);
  });

  it("marks the block when today is outside its range", () => {
    expect(planPending(makePlan(), "2026-12-02")).toEqual({
      initial: false,
      day: true,
      week: true,
      block: true,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
  });

  it("marks next week and next block when tomorrow has crossed both", () => {
    const plan = makePlan();
    plan.block = { ...plan.block, endDate: "2026-10-25" };
    plan.today = { ...plan.today, date: "2026-10-25" };

    expect(planPending(plan, "2026-10-25", true)).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: true,
      nextWeek: true,
      nextBlock: true,
      dietProgress: false,
    });
  });

  it("marks diet progress pending when a future period is missing a target", () => {
    const plan = makePlan();
    plan.diet = {
      goal: "Lose 3 kg by March",
      goalProvided: true,
      assessment: "On target.",
    };
    plan.week = {
      ...plan.week,
      dietProgress: {
        targetWeightKg: 80,
        targetBodyFatPercent: 20,
        note: "Hold this week.",
      },
    };

    expect(
      planPending(plan, "2026-10-21", false, false, false, true).dietProgress,
    ).toBe(true);
  });

  it("does not mark diet progress pending when every future period has a target", () => {
    const progress = {
      targetWeightKg: 80,
      targetBodyFatPercent: 20,
      note: "On target.",
    };
    const plan = makePlan();
    plan.diet = {
      goal: "Lose 3 kg by March",
      goalProvided: true,
      assessment: "On target.",
    };
    plan.season = { ...plan.season, dietProgress: progress };
    plan.season.blocks = plan.season.blocks.map((block) => ({
      ...block,
      dietProgress: progress,
    }));
    plan.block = { ...plan.block, dietProgress: progress };
    plan.block.weeks = plan.block.weeks.map((week) => ({
      ...week,
      dietProgress: progress,
    }));
    plan.week = { ...plan.week, dietProgress: progress };

    expect(
      planPending(plan, "2026-10-21", false, false, false, true).dietProgress,
    ).toBe(false);
  });

  it("requests one progress refresh for an older plan with no stored goal", () => {
    expect(
      planPending(makePlan(), "2026-10-21", false, false, false, true)
        .dietProgress,
    ).toBe(true);
  });

  it("marks diet progress pending when the season target misses the stated goal", () => {
    const progress = {
      targetWeightKg: 84,
      targetBodyFatPercent: 20,
      note: "On target.",
    };
    const plan = makePlan();
    plan.diet = {
      goal: "Lose fat gradually toward 15% body fat",
      goalProvided: true,
      goalWeightKg: null,
      goalBodyFatPercent: 15,
      goalDate: null,
      assessment: "On target.",
    };
    plan.season = { ...plan.season, dietProgress: progress };
    plan.season.blocks = plan.season.blocks.map((block) => ({
      ...block,
      dietProgress: progress,
    }));
    plan.block = { ...plan.block, dietProgress: progress };
    plan.block.weeks = plan.block.weeks.map((week) => ({
      ...week,
      dietProgress: progress,
    }));
    plan.week = { ...plan.week, dietProgress: progress };

    expect(
      planPending(plan, "2026-10-21", false, false, false, true).dietProgress,
    ).toBe(true);
  });

  it("reads a legacy goal text when deciding whether to refresh progress", () => {
    const progress = {
      targetWeightKg: 84,
      targetBodyFatPercent: 23.7,
      note: "On target.",
    };
    const plan = makePlan();
    plan.diet = {
      goal: "Lose fat gradually toward 15% body fat",
      goalProvided: true,
      assessment: "On target.",
    };
    plan.season = { ...plan.season, dietProgress: progress };
    plan.season.blocks = plan.season.blocks.map((block) => ({
      ...block,
      dietProgress: progress,
    }));
    plan.block = { ...plan.block, dietProgress: progress };
    plan.block.weeks = plan.block.weeks.map((week) => ({
      ...week,
      dietProgress: progress,
    }));
    plan.week = { ...plan.week, dietProgress: progress };

    expect(
      planPending(plan, "2026-10-21", false, false, false, true).dietProgress,
    ).toBe(true);
  });

  it("ignores diet progress without diet advice or a stated goal", () => {
    const plan = makePlan();
    plan.diet = {
      goal: "Maintain current weight",
      goalProvided: false,
      assessment: "Holding.",
    };

    expect(
      planPending(plan, "2026-10-21", false, false, false, true).dietProgress,
    ).toBe(false);
    expect(
      planPending(plan, "2026-10-21", false, false, false, false).dietProgress,
    ).toBe(false);
  });

  it("does not mark next periods when they already cover tomorrow", () => {
    const plan = makePlan();
    plan.block = { ...plan.block, endDate: "2026-10-25" };
    plan.today = { ...plan.today, date: "2026-10-25" };
    plan.tomorrow = {
      date: "2026-10-26",
      type: "workout",
      title: "Easy run",
      description: "Easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      status: "planned",
    };
    plan.nextWeek = {
      ...plan.week,
      startDate: "2026-10-26",
      sessions: plan.week.sessions.map((session, index) => ({
        ...session,
        date: addDays("2026-10-26", index),
      })),
    };
    plan.nextBlock = {
      ...plan.block,
      startDate: "2026-10-26",
      endDate: "2026-12-06",
    };

    expect(planPending(plan, "2026-10-25", true)).toEqual({
      initial: false,
      day: false,
      week: false,
      block: false,
      tomorrow: false,
      nextWeek: false,
      nextBlock: false,
      dietProgress: false,
    });
  });
});

describe("planIsStale", () => {
  it("is stale when the current answers are newer", () => {
    expect(
      planIsStale(
        new Date("2026-10-20T10:00:00Z"),
        new Date("2026-10-21T10:00:00Z"),
      ),
    ).toBe(true);
  });

  it("is not stale when the plan matches the answers", () => {
    const timestamp = new Date("2026-10-21T10:00:00Z");
    expect(planIsStale(timestamp, timestamp)).toBe(false);
  });

  it("treats a missing stored timestamp as older", () => {
    expect(planIsStale(null, new Date("2026-10-21T10:00:00Z"))).toBe(true);
    expect(planIsStale(null, null)).toBe(false);
  });
});

describe("latestActivityAnalysisTimestamp", () => {
  it("returns the newest analysis, ignoring unanalysed activities", () => {
    expect(
      latestActivityAnalysisTimestamp([
        { analysis: null },
        { analysis: { generatedAt: "2026-10-20T10:00:00Z" } },
        { analysis: { generatedAt: "2026-10-21T10:00:00Z" } },
      ]),
    ).toEqual(new Date("2026-10-21T10:00:00Z"));
  });

  it("returns null without an analysis", () => {
    expect(latestActivityAnalysisTimestamp([])).toBeNull();
    expect(latestActivityAnalysisTimestamp([{ analysis: null }])).toBeNull();
  });
});

describe("latestAnswerTimestamp", () => {
  it("returns the newest answeredAt, ignoring unanswered questions", () => {
    expect(
      latestAnswerTimestamp([
        { answeredAt: new Date("2026-10-20T10:00:00Z") },
        { answeredAt: new Date("2026-10-21T10:00:00Z") },
        { answeredAt: null },
      ]),
    ).toEqual(new Date("2026-10-21T10:00:00Z"));
  });

  it("returns null when nothing was answered", () => {
    expect(latestAnswerTimestamp([{ answeredAt: null }])).toBeNull();
    expect(latestAnswerTimestamp([])).toBeNull();
  });
});
