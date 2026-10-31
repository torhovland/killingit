import { describe, expect, it } from "bun:test";
import {
  checkReviseSeasonGates,
  combinePromptScores,
  filterByMinimumAbility,
  parseAbilityGrade,
  parseCurrentBlock,
  validateReviseSeasonPlan,
  validateTodayPlan,
} from "./promptBenchmark.js";

const PROMPT_FIXTURE = `Athlete profile: test.

Current block plan:
Block: Rebuild and Fat-Loss Foundation
Focus: Rebuild consistency with easy aerobic work and back-safe strength.
Dates: 2026-10-26 → 2026-11-23 — estimated FTP 220 W
Rationale: The block rebuilds consistency.
Weeks:
- Week 1 (from 2026-10-26): Restore rhythm with controlled strength; target load: 6-7 hours; estimated FTP 220 W
- Week 2 (from 2026-11-02): Add one steady ride; target load: 7-8 hours; estimated FTP 221 W

Current week plan:
Week starting 2026-10-26 — focus: Restore rhythm.
`;

const WEEK_DATES = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
];

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function daySession(date: string, day: string): Record<string, unknown> {
  return {
    date,
    day,
    type: "workout",
    title: "Easy ride",
    description: "An easy aerobic ride.",
    durationMinutes: 60,
    intensity: "easy",
    status: "planned",
    estimatedTss: 40,
    estimatedFtpWatts: 220,
    outdoor: false,
    canBeOutdoor: true,
    bikeWorkout: null,
  };
}

function todaySession(date: string): Record<string, unknown> {
  return {
    date,
    type: "workout",
    title: "Easy ride",
    description: "An easy aerobic ride.",
    durationMinutes: 60,
    intensity: "easy",
    status: "planned",
    alternatives: ["Rest"],
    rationale: "Easy aerobic work rebuilds the base.",
    optional: false,
    optionalRationale: "Skipping it delays the rebuild.",
    estimatedTss: 40,
    outdoor: false,
    canBeOutdoor: true,
    bikeWorkout: null,
  };
}

function validRevisePlan(): Record<string, unknown> {
  return {
    season: {
      goal: "Atlas and PBP",
      rationale: "Atlas is the next goal.",
      startDate: "2026-10-26",
      endDate: "2027-08-29",
      blocks: [
        {
          name: "Atlas build",
          focus: "Build for Atlas.",
          startDate: "2026-10-26",
          endDate: "2026-12-25",
          weekCount: 9,
        },
      ],
    },
    block: {
      name: "Atlas build",
      focus: "Build for Atlas.",
      rationale: "Eight weeks to Atlas.",
      startDate: "2026-10-26",
      endDate: "2026-12-25",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-26",
          focus: "Rebuild.",
          targetLoad: "6-7 hours.",
          estimatedFtpWatts: 220,
        },
      ],
    },
    week: {
      startDate: "2026-10-26",
      focus: "Rebuild.",
      rationale: "Start of the Atlas build.",
      estimatedFtpWatts: 220,
      sessions: WEEK_DATES.map((date, index) =>
        daySession(date, DAYS[index] ?? "Monday"),
      ),
    },
    today: todaySession("2026-10-31"),
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    bodyMetrics: [],
  };
}

describe("validateTodayPlan", () => {
  it("accepts the single-day contract", () => {
    expect(validateTodayPlan({ today: todaySession("2026-10-30") })).toEqual(
      [],
    );
  });

  it("rejects a wrong date and extra root keys", () => {
    const errors = validateTodayPlan({
      today: todaySession("2026-10-31"),
      week: {},
    });
    expect(errors).toContain("today date must be 2026-10-30");
    expect(errors).toContain("unexpected top-level keys: week");
  });
});

describe("validateReviseSeasonPlan", () => {
  it("accepts the revision contract", () => {
    expect(validateReviseSeasonPlan(validRevisePlan())).toEqual([]);
  });

  it("rejects a changed tomorrow and a broken week", () => {
    const plan = validRevisePlan();
    plan.tomorrow = todaySession("2026-11-01");
    const week = plan.week as Record<string, unknown>;
    week.sessions = (week.sessions as unknown[]).slice(0, 6);
    const errors = validateReviseSeasonPlan(plan);
    expect(errors).toContain("tomorrow must stay null as supplied");
    expect(errors).toContain(
      "week: sessions must contain exactly seven sessions",
    );
  });

  it("requires today to match the week's session on that date", () => {
    const plan = validRevisePlan();
    const week = plan.week as Record<string, unknown>;
    const sessions = week.sessions as Array<Record<string, unknown>>;
    const matching = sessions.find((session) => session.date === "2026-10-31");
    if (matching) matching.title = "Different title";
    expect(validateReviseSeasonPlan(plan)).toContain(
      "today title must match the week's session on that date",
    );
  });

  it("requires today to be one of the week's sessions", () => {
    const plan = validRevisePlan();
    const week = plan.week as Record<string, unknown>;
    const withoutToday = [
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-11-01",
      "2026-10-26",
    ];
    week.sessions = withoutToday.map((date, index) =>
      daySession(date, DAYS[index] ?? "Monday"),
    );
    expect(validateReviseSeasonPlan(plan)).toContain(
      "today must be one of the week's sessions",
    );
  });
});

describe("parseCurrentBlock", () => {
  it("reads the block and its weeks from the prompt", () => {
    const baseline = parseCurrentBlock(PROMPT_FIXTURE);
    expect(baseline).not.toBeNull();
    expect(baseline?.name).toBe("Rebuild and Fat-Loss Foundation");
    expect(baseline?.startDate).toBe("2026-10-26");
    expect(baseline?.endDate).toBe("2026-11-23");
    expect(baseline?.weeks).toHaveLength(2);
    expect(baseline?.weeks[0]).toEqual({
      number: 1,
      startDate: "2026-10-26",
      focus: "Restore rhythm with controlled strength",
      targetLoad: "6-7 hours",
      estimatedFtpWatts: 220,
    });
  });

  it("returns null when the block section is absent", () => {
    expect(parseCurrentBlock("nothing here")).toBeNull();
  });
});

describe("checkReviseSeasonGates", () => {
  const parsedBaseline = parseCurrentBlock(PROMPT_FIXTURE);
  if (parsedBaseline === null) throw new Error("fixture did not parse");
  const baseline = parsedBaseline;

  function candidate(overrides: {
    atlas?: boolean;
    focus?: string;
    blockStart?: string;
    seasonStart?: string;
  }): Record<string, unknown> {
    return {
      season: {
        blocks: [
          {
            startDate: overrides.seasonStart ?? "2026-10-26",
          },
        ],
      },
      block: {
        focus: overrides.focus ?? "Original focus.",
        endDate: "2026-12-25",
        startDate: overrides.blockStart ?? "2026-10-26",
        weeks: baseline.weeks.map((week) => ({
          startDate: week.startDate,
          focus: week.focus,
          targetLoad: week.targetLoad,
          estimatedFtpWatts: week.estimatedFtpWatts,
        })),
      },
      note: overrides.atlas === false ? "No new race." : "Atlas Mountain Race.",
    };
  }

  function candidateWithoutWeeks(): Record<string, unknown> {
    return {
      season: { blocks: [{ startDate: "2026-10-26" }] },
      block: {
        focus: baseline.focus,
        endDate: baseline.endDate,
        startDate: "2026-10-26",
        weeks: baseline.weeks.map((week) => ({
          startDate: week.startDate,
          focus: week.focus,
          targetLoad: week.targetLoad,
          estimatedFtpWatts: week.estimatedFtpWatts,
        })),
      },
      note: "Atlas Mountain Race.",
    };
  }

  it("passes when Atlas is named, the block changes and the date stays", () => {
    const gates = checkReviseSeasonGates(
      candidate({ focus: "Build for the Atlas Mountain Race." }),
      baseline,
    );
    expect(gates.atlasMentioned).toBe(true);
    expect(gates.blockOneChanged).toBe(true);
    expect(gates.blockOneStartDateKept).toBe(true);
    expect(gates.failures).toEqual([]);
  });

  it("fails when Atlas is missing", () => {
    const gates = checkReviseSeasonGates(
      candidate({ atlas: false, focus: "Build for the new race." }),
      baseline,
    );
    expect(gates.failures).toEqual(["the response never mentions Atlas"]);
  });

  it("fails when block 1 is unchanged", () => {
    const gates = checkReviseSeasonGates(candidateWithoutWeeks(), baseline);
    expect(gates.blockOneChanged).toBe(false);
    expect(gates.failures).toContain("block 1 is unchanged");
  });

  it("fails when the block start date changes", () => {
    const gates = checkReviseSeasonGates(
      candidate({
        focus: "Atlas build.",
        blockStart: "2026-10-31",
      }),
      baseline,
    );
    expect(gates.blockOneStartDateKept).toBe(false);
    expect(gates.failures).toContain("block 1 does not start on 2026-10-26");
  });

  it("fails when the season's block 1 start date changes", () => {
    const gates = checkReviseSeasonGates(
      candidate({ focus: "Atlas build.", seasonStart: "2026-10-27" }),
      baseline,
    );
    expect(gates.blockOneStartDateKept).toBe(false);
  });
});

describe("combinePromptScores", () => {
  const fullComponents = {
    contract: 1.5,
    fidelity: 2,
    design: 3,
    rationale: 2,
    grounding: 2,
    detail: 2,
  };

  it("averages the scores and keeps the weaker component", () => {
    const combined = combinePromptScores(
      { score: 11.4, components: fullComponents, note: "Strong." },
      {
        score: 9.2,
        components: { ...fullComponents, design: 1.8 },
        note: "Weaker design.",
      },
      [],
    );
    expect(combined.score).toBe(10.3);
    expect(combined.components.design).toBe(1.8);
    expect(combined.components.contract).toBe(1.5);
    expect(combined.failed).toBe(false);
    expect(combined.note).toContain("Today plan: Strong.");
    expect(combined.note).toContain("Season revision: Weaker design.");
  });

  it("fails when a hard gate fails", () => {
    const combined = combinePromptScores(
      { score: 11.4, components: fullComponents, note: "Strong." },
      { score: 11.2, components: fullComponents, note: "Strong too." },
      ["the response never mentions Atlas"],
    );
    expect(combined.failed).toBe(true);
    expect(combined.note).toContain("Hard gates failed");
  });
});

describe("ability selection", () => {
  it("parses a minimum grade", () => {
    expect(parseAbilityGrade("a")).toBe("A");
    expect(parseAbilityGrade("A+")).toBe("A+");
    expect(parseAbilityGrade("nope")).toBeNull();
  });

  it("keeps models at or above the minimum grade plus every ungraded model", () => {
    const models = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
      { id: "e" },
    ];
    const grades = new Map([
      ["a", "A+" as const],
      ["b", "A" as const],
      ["c", "B" as const],
      ["d", "?" as const],
    ]);
    expect(
      filterByMinimumAbility(models, grades, "A").map((model) => model.id),
    ).toEqual(["a", "b", "d", "e"]);
  });
});
