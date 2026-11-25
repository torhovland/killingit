import { describe, expect, it } from "bun:test";
import type {
  AthleteEvent,
  BlockPlan,
  SeasonGoal,
  SeasonPlan,
} from "@killingit/shared";
import { blockGoalProblems, seasonGoalProblems } from "./goals.js";
import { makeBlock, makeSeason } from "../testFixtures/plan.js";

const TODAY = "2027-06-21";

const GRAVEL: SeasonGoal = {
  title: "100 km gravel race",
  date: "2027-08-22",
  priority: "A",
  target: "3:10 or faster",
};

const HALF: SeasonGoal = {
  title: "Sub-2:00 half marathon",
  date: "2027-05-23",
  priority: "A",
  target: "Under 2:00",
};

function season(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return makeSeason({
    goals: [HALF, GRAVEL],
    startDate: "2026-11-22",
    endDate: "2027-08-29",
    blocks: [
      {
        name: "Gravel build",
        focus: "Build gravel durability.",
        startDate: "2027-06-21",
        endDate: "2027-08-07",
        weekCount: 7,
        subGoals: [
          {
            goalTitle: GRAVEL.title,
            goalDate: GRAVEL.date,
            role: "build",
            target: "3 h ride",
            byDate: "2027-07-18",
          },
        ],
      },
    ],
    ...overrides,
  });
}

function block(overrides: Partial<BlockPlan> = {}): BlockPlan {
  return makeBlock({
    name: "Gravel build",
    startDate: "2027-06-21",
    endDate: "2027-08-07",
    subGoals: [
      {
        goalTitle: GRAVEL.title,
        goalDate: GRAVEL.date,
        role: "build",
        target: "3 h ride",
        byDate: "2027-07-18",
      },
    ],
    ...overrides,
  });
}

function events(...entries: AthleteEvent[]): AthleteEvent[] {
  return entries;
}

describe("seasonGoalProblems", () => {
  it("accepts a season that lists and covers every upcoming goal", () => {
    expect(
      seasonGoalProblems(season(), {
        today: TODAY,
        events: events({
          startDate: GRAVEL.date,
          endDate: null,
          title: "100 km gravel race",
          kind: "race",
        }),
      }),
    ).toEqual([]);
  });

  it("requires a goal for every upcoming race or goal event", () => {
    const problems = seasonGoalProblems(
      season({
        goals: [HALF, GRAVEL],
        blocks: [
          {
            name: "Gravel build",
            focus: "Build gravel durability.",
            startDate: "2027-06-21",
            endDate: "2027-08-07",
            weekCount: 7,
            subGoals: [
              {
                goalTitle: GRAVEL.title,
                goalDate: GRAVEL.date,
                role: "build",
                target: "3 h ride",
                byDate: "2027-07-18",
              },
            ],
          },
        ],
      }),
      {
        today: TODAY,
        events: events({
          startDate: "2027-09-12",
          endDate: null,
          title: "Autumn sportive",
          kind: "race",
        }),
      },
    );
    expect(problems).toContain(
      "The season's \"goals\" does not include the athlete's goal on 2027-09-12.",
    );
  });

  it("ignores trips and past events", () => {
    expect(
      seasonGoalProblems(season(), {
        today: TODAY,
        events: events(
          {
            startDate: "2027-07-10",
            endDate: "2027-07-12",
            title: "Family trip",
            kind: "trip",
          },
          {
            startDate: "2027-01-10",
            endDate: null,
            title: "Old race",
            kind: "race",
          },
        ),
      }),
    ).toEqual([]);
  });

  it("rejects a current block without structured sub-goals", () => {
    const problems = seasonGoalProblems(
      season({
        blocks: [
          {
            name: "Gravel build",
            focus: "Build gravel durability.",
            startDate: "2027-06-21",
            endDate: "2027-08-07",
            weekCount: 7,
          },
        ],
      }),
      { today: TODAY },
    );
    expect(problems).toContain(
      'The season block "Gravel build" must carry "subGoals" for every goal still ahead of it.',
    );
  });

  it("requires every goal still ahead to be accounted for", () => {
    const problems = seasonGoalProblems(
      season({
        goals: [
          HALF,
          GRAVEL,
          { ...GRAVEL, title: "Later goal", date: "2027-09-12" },
        ],
        blocks: [
          {
            name: "Gravel build",
            focus: "Build gravel durability.",
            startDate: "2027-06-21",
            endDate: "2027-08-07",
            weekCount: 7,
            subGoals: [
              {
                goalTitle: GRAVEL.title,
                goalDate: GRAVEL.date,
                role: "build",
                target: "3 h ride",
                byDate: "2027-07-18",
              },
            ],
          },
        ],
      }),
      { today: TODAY },
    );
    expect(problems).toContain(
      'The season block "Gravel build" does not account for the goal "Later goal" on 2027-09-12.',
    );
  });

  it("rejects a sub-goal outside the block and one that names no season goal", () => {
    const problems = seasonGoalProblems(
      season({
        blocks: [
          {
            name: "Gravel build",
            focus: "Build gravel durability.",
            startDate: "2027-06-21",
            endDate: "2027-08-07",
            weekCount: 7,
            subGoals: [
              {
                goalTitle: GRAVEL.title,
                goalDate: GRAVEL.date,
                role: "build",
                target: "3 h ride",
                byDate: "2027-08-20",
              },
              {
                goalTitle: "Invented goal",
                goalDate: "2027-09-01",
                role: "maintain",
                target: "Something",
                byDate: "2027-07-01",
              },
            ],
          },
        ],
      }),
      { today: TODAY },
    );
    expect(problems).toContain(
      'The season block "Gravel build" has the sub-goal "3 h ride" due on 2027-08-20, which is outside the block\'s dates.',
    );
    expect(problems).toContain(
      'The season block "Gravel build" has a sub-goal for "Invented goal" on 2027-09-01, which is not in the season\'s goals.',
    );
  });

  it("requires a recovery block to account for the goals still ahead", () => {
    const problems = seasonGoalProblems(
      season({
        goals: [GRAVEL],
        blocks: [
          {
            name: "Recovery",
            focus: "Recover.",
            startDate: "2027-06-21",
            endDate: "2027-06-27",
            weekCount: 1,
            subGoals: [],
          },
        ],
      }),
      { today: TODAY },
    );
    expect(problems).toContain(
      'The season block "Recovery" does not account for the goal "100 km gravel race" on 2027-08-22.',
    );
  });
});

describe("blockGoalProblems", () => {
  it("accepts a block whose ledger matches the season summary", () => {
    expect(blockGoalProblems(block(), season(), { today: TODAY })).toEqual([]);
  });

  it("rejects a detailed block without sub-goals", () => {
    const without = block();
    delete without.subGoals;
    expect(blockGoalProblems(without, season(), { today: TODAY })).toContain(
      'The block "Gravel build" must carry "subGoals" for every goal still ahead of it.',
    );
  });

  it("ignores a cosmetic difference in the goal title", () => {
    const titled = block({
      subGoals: [
        {
          goalTitle: "2027-08-22 100 km gravel race",
          goalDate: GRAVEL.date,
          role: "build",
          target: "3 h ride",
          byDate: "2027-07-18",
        },
      ],
    });
    expect(blockGoalProblems(titled, season(), { today: TODAY })).toEqual([]);
  });

  it("rejects sub-goals that differ from the season summary", () => {
    const different = block({
      subGoals: [
        {
          goalTitle: GRAVEL.title,
          goalDate: GRAVEL.date,
          role: "maintain",
          target: "2 h ride",
          byDate: "2027-07-18",
        },
      ],
    });
    expect(blockGoalProblems(different, season(), { today: TODAY })).toContain(
      'The block "Gravel build" must use the same sub-goals as its season summary.',
    );
  });
});
