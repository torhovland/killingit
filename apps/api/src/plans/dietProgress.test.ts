import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import {
  mergeDietProgressTargets,
  syncDietProgressTargets,
} from "./dietProgress.js";

const progress = (targetWeightKg: number) => ({
  targetWeightKg,
  targetBodyFatPercent: null,
  note: "Expected progress.",
});

function plan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return {
    season: {
      goal: "Ride a century.",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build endurance.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic",
          startDate: "2026-10-19",
          endDate: "2026-11-29",
          weekCount: 6,
          dietProgress: progress(80),
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic",
      startDate: "2026-10-19",
      endDate: "2026-11-29",
      rationale: "Build the base.",
      dietProgress: progress(79),
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic",
          targetLoad: "Easy",
          dietProgress: progress(80),
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic",
      rationale: "Keep it easy.",
      dietProgress: progress(80.5),
      sessions: [],
    },
    today: {
      date: "2026-10-22",
      type: "rest",
      title: "Rest",
      description: "Rest.",
      durationMinutes: 0,
      intensity: "rest",
      alternatives: [],
      rationale: "Recovery.",
      optional: false,
      status: "rest",
    },
    tomorrow: null,
    nextWeek: null,
    nextBlock: null,
    ...overrides,
  };
}

describe("syncDietProgressTargets", () => {
  it("copies the detailed block target into the season block summary", () => {
    const synced = syncDietProgressTargets(plan());

    expect(synced.season.blocks[0]?.dietProgress?.targetWeightKg).toBe(79);
  });

  it("copies the detailed week target into the block week summary", () => {
    const synced = syncDietProgressTargets(plan());

    expect(synced.block.weeks[0]?.dietProgress?.targetWeightKg).toBe(80.5);
  });

  it("keeps a summary when the detailed level omits the target", () => {
    const base = plan();
    const synced = syncDietProgressTargets({
      ...base,
      block: { ...base.block, dietProgress: undefined },
      week: { ...base.week, dietProgress: undefined },
    });

    expect(synced.season.blocks[0]?.dietProgress?.targetWeightKg).toBe(80);
    expect(synced.block.weeks[0]?.dietProgress?.targetWeightKg).toBe(80);
  });

  it("syncs the season-end target from the last block when they end together", () => {
    const base = plan();
    const synced = syncDietProgressTargets({
      ...base,
      season: {
        ...base.season,
        endDate: "2026-11-29",
        dietProgress: progress(78),
        blocks: base.season.blocks.map((block) => ({
          ...block,
          endDate: "2026-11-29",
        })),
      },
      block: {
        ...base.block,
        endDate: "2026-11-29",
        dietProgress: progress(79),
      },
    });

    expect(synced.season.dietProgress?.targetWeightKg).toBe(79);
  });

  it("merges progress from an update without replacing training content", () => {
    const base = plan();
    const merged = mergeDietProgressTargets(base, {
      ...base,
      season: {
        ...base.season,
        dietProgress: progress(77),
        blocks: base.season.blocks.map((block) => ({
          ...block,
          dietProgress: progress(77),
        })),
      },
      block: {
        ...base.block,
        focus: "A changed focus that must be ignored",
        dietProgress: progress(76),
        weeks: base.block.weeks.map((week) => ({
          ...week,
          dietProgress: progress(76),
        })),
      },
      week: { ...base.week, dietProgress: progress(76.5) },
    });

    expect(merged.season.dietProgress?.targetWeightKg).toBe(77);
    expect(merged.season.blocks[0]?.dietProgress?.targetWeightKg).toBe(77);
    expect(merged.block.dietProgress?.targetWeightKg).toBe(76);
    expect(merged.block.focus).toBe(base.block.focus);
    expect(merged.block.weeks[0]?.dietProgress?.targetWeightKg).toBe(76);
    expect(merged.week.dietProgress?.targetWeightKg).toBe(76.5);
  });

  it("ignores an omitted progress field but copies an explicit null", () => {
    const base = plan();
    base.season = { ...base.season, dietProgress: progress(80.2) };
    const omitted = mergeDietProgressTargets(base, {
      ...base,
      season: { ...base.season, dietProgress: undefined },
      block: { ...base.block, dietProgress: undefined },
      week: { ...base.week, dietProgress: undefined },
    });
    expect(omitted.season.dietProgress?.targetWeightKg).toBe(80.2);
    expect(omitted.block.dietProgress?.targetWeightKg).toBe(79);
    expect(omitted.week.dietProgress?.targetWeightKg).toBe(80.5);

    const cleared = mergeDietProgressTargets(base, {
      ...base,
      week: { ...base.week, dietProgress: null },
    });
    expect(cleared.week.dietProgress).toBeNull();
  });

  it("syncs the next block and next week too", () => {
    const base = plan();
    const synced = syncDietProgressTargets({
      ...base,
      season: {
        ...base.season,
        blocks: [
          ...base.season.blocks,
          {
            name: "Build",
            focus: "Threshold",
            startDate: "2026-11-30",
            endDate: "2027-01-10",
            weekCount: 6,
            dietProgress: progress(78),
          },
        ],
      },
      nextBlock: {
        ...base.block,
        name: "Build",
        startDate: "2026-11-30",
        endDate: "2027-01-10",
        dietProgress: progress(77),
        weeks: [
          {
            number: 1,
            startDate: "2026-11-30",
            focus: "Threshold",
            targetLoad: "Hard",
            dietProgress: progress(76),
          },
        ],
      },
      nextWeek: {
        ...base.week,
        startDate: "2026-11-30",
        dietProgress: progress(76.5),
      },
    });

    expect(synced.season.blocks[1]?.dietProgress?.targetWeightKg).toBe(77);
    expect(synced.nextBlock?.weeks[0]?.dietProgress?.targetWeightKg).toBe(76.5);
  });
});
