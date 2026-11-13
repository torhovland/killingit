import { describe, expect, it } from "bun:test";
import type {
  BlockPlan,
  CoachPlan,
  PlanPending,
  SeasonPlan,
  WeekPlan,
} from "@killingit/shared";
import {
  makeBlock,
  makeDay,
  makePlan,
  makeSeason,
  makeWeek,
} from "../testFixtures/plan.js";
import {
  mergeNextPeriod,
  mergeSeasonAndBlock,
  mergeTomorrow,
  mergeWeekAndDay,
  revisionFlags,
  type PlanUpdateFlags,
  type RevisionChoice,
} from "./revision.js";

/** No level pending unless the test says otherwise. */
function makePending(overrides: Partial<PlanPending> = {}): PlanPending {
  return {
    initial: false,
    day: false,
    week: false,
    block: false,
    tomorrow: false,
    nextWeek: false,
    nextBlock: false,
    dietProgress: false,
    ...overrides,
  };
}

const NO_REVISION: RevisionChoice = {
  kind: "advance",
  revisionNeeded: false,
  weekReviewPending: false,
};

function makeFlags(overrides: Partial<PlanUpdateFlags> = {}): PlanUpdateFlags {
  return {
    season: false,
    block: false,
    week: false,
    day: false,
    tomorrow: false,
    nextWeek: false,
    nextBlock: false,
    clearNextPeriod: false,
    blockInPlace: false,
    progress: true,
    ...overrides,
  };
}

function flagsFor(
  input: {
    current?: CoachPlan;
    today?: string;
    pending?: Partial<PlanPending>;
    decision?: Partial<RevisionChoice>;
    includeTomorrow?: boolean;
  } = {},
): PlanUpdateFlags {
  return revisionFlags({
    current: input.current ?? makePlan(),
    today: input.today ?? "2026-10-21",
    pending: makePending(input.pending),
    decision: { ...NO_REVISION, ...input.decision },
    includeTomorrow: input.includeTomorrow ?? false,
  });
}

describe("revisionFlags", () => {
  it("revises only today and the week around it when the day is pending", () => {
    expect(flagsFor({ today: "2026-10-22", pending: { day: true } })).toEqual(
      makeFlags({ week: true, day: true }),
    );
  });

  it("revises the week and today around a newly analysed input", () => {
    expect(
      flagsFor({
        decision: { revisionNeeded: true },
      }),
    ).toEqual(makeFlags({ week: true, day: true, clearNextPeriod: true }));
  });

  it("revises the week and day and clears the next period when the week is pending", () => {
    expect(flagsFor({ pending: { week: true } })).toEqual(
      makeFlags({ week: true, day: true, clearNextPeriod: true }),
    );
  });

  it("revises the block, week and day when the block is pending", () => {
    expect(flagsFor({ pending: { block: true } })).toEqual(
      makeFlags({
        block: true,
        week: true,
        day: true,
        clearNextPeriod: true,
      }),
    );
  });

  it("revises a block in place around a week review without a season refresh", () => {
    expect(flagsFor({ decision: { weekReviewPending: true } })).toEqual(
      makeFlags({
        block: true,
        week: true,
        day: true,
        clearNextPeriod: true,
        blockInPlace: true,
      }),
    );
  });

  it("starts the next block when a week review arrives after today left it", () => {
    const current = makePlan({
      block: makeBlock({ startDate: "2026-10-01", endDate: "2026-10-20" }),
    });

    const flags = flagsFor({
      current,
      today: "2026-10-21",
      pending: { block: true },
      decision: { weekReviewPending: true },
    });

    expect(flags.block).toBe(true);
    expect(flags.blockInPlace).toBe(false);
  });

  it("refreshes the season and every level on an explicit refresh", () => {
    expect(
      flagsFor({
        decision: { kind: "refresh" },
        includeTomorrow: true,
        pending: { tomorrow: true },
      }),
    ).toEqual(
      makeFlags({
        season: true,
        block: true,
        week: true,
        day: true,
        tomorrow: true,
        clearNextPeriod: true,
      }),
    );
  });

  it("keeps today's session for a next-block revision that lands in the current week", () => {
    const current = makePlan({
      block: makeBlock({ startDate: "2026-10-21", endDate: "2026-10-20" }),
    });

    expect(
      flagsFor({
        current,
        today: "2026-10-19",
        pending: { nextBlock: true, tomorrow: true },
        includeTomorrow: true,
      }),
    ).toEqual(
      makeFlags({
        week: true,
        tomorrow: true,
        nextBlock: true,
        clearNextPeriod: true,
      }),
    );
  });

  it("revises the next block and next week when tomorrow leaves both", () => {
    const current = makePlan({
      today: makeDay("2026-10-25"),
      week: makeWeek("2026-10-19"),
      block: makeBlock({ startDate: "2026-10-21", endDate: "2026-10-25" }),
    });

    expect(
      flagsFor({
        current,
        today: "2026-10-25",
        pending: { tomorrow: true, nextWeek: true, nextBlock: true },
        includeTomorrow: true,
      }),
    ).toEqual(
      makeFlags({
        tomorrow: true,
        nextWeek: true,
        nextBlock: true,
        clearNextPeriod: true,
      }),
    );
  });

  it("plans the next week without revising the current week", () => {
    const current = makePlan({
      today: makeDay("2026-10-25"),
      week: makeWeek("2026-10-19"),
    });

    expect(
      flagsFor({
        current,
        today: "2026-10-25",
        pending: { tomorrow: true, nextWeek: true },
        includeTomorrow: true,
      }),
    ).toEqual(makeFlags({ tomorrow: true, nextWeek: true }));
  });

  it("ignores tomorrow when the run does not want it", () => {
    expect(flagsFor({ pending: { tomorrow: true, nextWeek: true } })).toEqual(
      makeFlags(),
    );
  });
});

/** A stored plan whose season already has one completed block. */
function makeCurrentSeason(): CoachPlan {
  return makePlan({
    season: makeSeason({
      startDate: "2026-10-01",
      introduction: "Hello from the first season.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-01",
          endDate: "2026-10-20",
          weekCount: 3,
        },
        {
          name: "Build",
          focus: "Threshold",
          startDate: "2026-10-21",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    }),
  });
}

/** The season a refresh returns from 2026-10-25. */
function makeRefreshedSeason(): SeasonPlan {
  return makeSeason({
    goal: "Run a faster marathon.",
    introduction: null,
    startDate: "2026-10-25",
    endDate: "2027-04-01",
    blocks: [
      {
        name: "Build",
        focus: "Threshold",
        startDate: "2026-10-21",
        endDate: "2026-11-15",
        weekCount: 4,
      },
      {
        name: "Peak",
        focus: "Race pace",
        startDate: "2026-11-16",
        endDate: "2027-04-01",
        weekCount: 20,
      },
    ],
  });
}

function makeRefreshBlock(): BlockPlan {
  return makeBlock({ startDate: "2026-10-21", endDate: "2026-11-15" });
}

function makeRefreshUpdate(): CoachPlan {
  return makePlan({
    season: makeRefreshedSeason(),
    block: makeRefreshBlock(),
  });
}

describe("mergeSeasonAndBlock", () => {
  it("keeps completed blocks, the season start and the greeting on a refresh", () => {
    const current = makeCurrentSeason();
    const update = makeRefreshUpdate();

    const plan = mergeSeasonAndBlock(
      current,
      update,
      makeFlags({ season: true, block: true }),
      "2026-10-25",
    );

    expect(plan.season.startDate).toBe("2026-10-01");
    expect(plan.season.endDate).toBe("2027-04-01");
    expect(plan.season.goal).toBe("Run a faster marathon.");
    expect(plan.season.introduction).toBe("Hello from the first season.");
    expect(plan.season.blocks.map((entry) => entry.name)).toEqual([
      "Base",
      "Build",
      "Peak",
    ]);
    expect(plan.block).toEqual(update.block);
  });

  it("rejects a refresh that moves the current block's start date", () => {
    const current = makeCurrentSeason();
    const update = makeRefreshUpdate();
    const moved: CoachPlan = {
      ...update,
      season: {
        ...update.season,
        blocks: update.season.blocks.map((entry) => ({
          ...entry,
          startDate: "2026-10-25",
        })),
      },
    };

    expect(() =>
      mergeSeasonAndBlock(
        current,
        moved,
        makeFlags({ season: true, block: true }),
        "2026-10-25",
      ),
    ).toThrow(/moved the current block's start date/);
  });

  it("takes the returned block and season on a block revision", () => {
    const current = makeCurrentSeason();
    const update: CoachPlan = {
      ...makePlan(),
      season: { ...makeSeason({ goal: "Rebuild." }), introduction: null },
      block: makeBlock({ startDate: "2026-10-21", endDate: "2026-11-01" }),
    };

    const plan = mergeSeasonAndBlock(
      current,
      update,
      makeFlags({ block: true }),
      "2026-10-25",
    );

    expect(plan.season.goal).toBe("Rebuild.");
    expect(plan.season.introduction).toBe("Hello from the first season.");
    expect(plan.block).toEqual(update.block);
  });

  it("refreshes only the season summary on a next-block revision", () => {
    const current = makeCurrentSeason();
    const update: CoachPlan = {
      ...makePlan(),
      season: { ...makeSeason({ goal: "Rebuild." }), introduction: null },
    };

    const plan = mergeSeasonAndBlock(
      current,
      update,
      makeFlags({ nextBlock: true }),
      "2026-10-25",
    );

    expect(plan.season.goal).toBe("Rebuild.");
    expect(plan.season.introduction).toBe("Hello from the first season.");
    expect(plan.block).toEqual(current.block);
  });

  it("leaves the stored levels alone when the season, block and next block did not change", () => {
    const current = makeCurrentSeason();

    expect(
      mergeSeasonAndBlock(
        current,
        makeRefreshUpdate(),
        makeFlags(),
        "2026-10-25",
      ),
    ).toBe(current);
  });
});

/** The same week with the named session replaced. */
function withSessionTitle(
  week: WeekPlan,
  date: string,
  title: string,
): WeekPlan {
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date === date ? { ...session, title } : session,
    ),
  };
}

describe("mergeWeekAndDay", () => {
  it("takes the returned week and today for a day revision", () => {
    const current = makePlan();
    const update: CoachPlan = {
      ...makePlan(),
      week: withSessionTitle(makeWeek("2026-10-19"), "2026-10-22", "Tempo"),
      today: makeDay("2026-10-22", { title: "Tempo" }),
    };

    const plan = mergeWeekAndDay(
      current,
      update,
      makeFlags({ week: true, day: true }),
    );

    expect(plan.week).toEqual(update.week);
    expect(plan.today).toEqual(update.today);
  });

  it("keeps the stored today for a week-only revision", () => {
    const current = makePlan();
    const update: CoachPlan = {
      ...makePlan(),
      week: withSessionTitle(makeWeek("2026-10-19"), "2026-10-24", "Long run"),
      today: makeDay("2026-10-22", { title: "Tempo" }),
    };

    const plan = mergeWeekAndDay(current, update, makeFlags({ week: true }));

    expect(plan.week).toEqual(update.week);
    expect(plan.today).toEqual(current.today);
  });

  it("leaves the stored week and today alone otherwise", () => {
    const current = makePlan();

    expect(mergeWeekAndDay(current, makePlan(), makeFlags())).toBe(current);
  });
});

describe("mergeNextPeriod", () => {
  function makePlanWithNextPeriod(): CoachPlan {
    return makePlan({
      nextWeek: makeWeek("2026-11-02"),
      nextBlock: makeBlock({
        startDate: "2026-12-02",
        endDate: "2027-01-01",
      }),
    });
  }

  it("clears the stored next period a full revision did not return", () => {
    const plan = mergeNextPeriod(
      makePlanWithNextPeriod(),
      makePlan(),
      makeFlags({ clearNextPeriod: true }),
    );

    expect(plan.nextWeek).toBeNull();
    expect(plan.nextBlock).toBeNull();
  });

  it("stores the returned next period when it was revised", () => {
    const update: CoachPlan = {
      ...makePlan(),
      nextWeek: makeWeek("2026-10-26"),
      nextBlock: makeBlock({
        startDate: "2026-10-26",
        endDate: "2026-12-06",
      }),
    };

    const plan = mergeNextPeriod(
      makePlanWithNextPeriod(),
      update,
      makeFlags({ nextWeek: true, nextBlock: true, clearNextPeriod: true }),
    );

    expect(plan.nextWeek).toEqual(update.nextWeek);
    expect(plan.nextBlock).toEqual(update.nextBlock);
  });

  it("keeps the returned next block while clearing a stale next week", () => {
    const update: CoachPlan = {
      ...makePlan(),
      nextBlock: makeBlock({
        startDate: "2026-10-26",
        endDate: "2026-12-06",
      }),
    };

    const plan = mergeNextPeriod(
      makePlanWithNextPeriod(),
      update,
      makeFlags({ nextBlock: true, clearNextPeriod: true }),
    );

    expect(plan.nextBlock).toEqual(update.nextBlock);
    expect(plan.nextWeek).toBeNull();
  });

  it("leaves the stored next period alone when nothing changed", () => {
    const current = makePlanWithNextPeriod();

    expect(mergeNextPeriod(current, makePlan(), makeFlags())).toBe(current);
  });
});

describe("mergeTomorrow", () => {
  it("stores tomorrow and copies its outline from the returned week", () => {
    const current = makePlan();
    const update: CoachPlan = {
      ...makePlan(),
      week: withSessionTitle(makeWeek("2026-10-19"), "2026-10-22", "Tempo"),
      tomorrow: makeDay("2026-10-22", { title: "Tempo" }),
    };

    const plan = mergeTomorrow(
      current,
      update,
      makeFlags({ week: true, day: true, tomorrow: true }),
      "2026-10-21",
    );

    expect(plan.tomorrow).toEqual(update.tomorrow);
    expect(
      plan.week.sessions.find((session) => session.date === "2026-10-22")
        ?.title,
    ).toBe("Tempo");
  });

  it("clears a stale tomorrow when the revision did not return it", () => {
    const current = makePlan({
      tomorrow: makeDay("2026-10-22"),
    });

    const plan = mergeTomorrow(
      current,
      makePlan(),
      makeFlags({ clearNextPeriod: true }),
      "2026-10-21",
    );

    expect(plan.tomorrow).toBeNull();
  });

  it("drops a tomorrow that is no longer the next day", () => {
    const current = makePlan();

    const plan = mergeTomorrow(
      current,
      { ...makePlan(), tomorrow: makeDay("2026-10-23") },
      makeFlags({ tomorrow: true }),
      "2026-10-21",
    );

    expect(plan.tomorrow).toBeNull();
  });

  it("copies tomorrow's outline into the next week", () => {
    const current = makePlan({
      today: makeDay("2026-10-25"),
      week: makeWeek("2026-10-19"),
      nextWeek: makeWeek("2026-10-26"),
    });
    const update: CoachPlan = {
      ...makePlan(),
      nextWeek: withSessionTitle(
        makeWeek("2026-10-26"),
        "2026-10-26",
        "Easy run",
      ),
      tomorrow: makeDay("2026-10-26", { title: "Easy run" }),
    };

    const plan = mergeTomorrow(
      current,
      update,
      makeFlags({ nextWeek: true, tomorrow: true }),
      "2026-10-25",
    );

    expect(
      plan.nextWeek?.sessions.find((session) => session.date === "2026-10-26")
        ?.title,
    ).toBe("Easy run");
    expect(plan.week).toEqual(current.week);
  });

  it("keeps the stored next week when the update did not return one", () => {
    const current = makePlan({
      today: makeDay("2026-10-25"),
      week: makeWeek("2026-10-19"),
      nextWeek: makeWeek("2026-10-26"),
    });

    const plan = mergeTomorrow(
      current,
      {
        ...makePlan(),
        tomorrow: makeDay("2026-10-26"),
      },
      makeFlags({ tomorrow: true }),
      "2026-10-25",
    );

    expect(plan.tomorrow?.date).toBe("2026-10-26");
    expect(plan.nextWeek).toEqual(current.nextWeek);
  });

  it("rejects a tomorrow outside every planned week", () => {
    const current = makePlan({
      today: makeDay("2026-10-25"),
      week: makeWeek("2026-10-19"),
    });

    expect(() =>
      mergeTomorrow(
        current,
        { ...makePlan(), tomorrow: makeDay("2026-10-26") },
        makeFlags({ tomorrow: true }),
        "2026-10-25",
      ),
    ).toThrow(/outside a planned week/);
  });
});
