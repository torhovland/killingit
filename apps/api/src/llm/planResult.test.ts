import { describe, expect, it } from "bun:test";
import {
  makeBlock,
  makeDay,
  makeSeason,
  makeWeek,
} from "../testFixtures/plan.js";
import {
  dailyPlanUpdateSchema,
  initialBlockUpdateSchema,
  seasonPlanUpdateSchema,
  weeklyPlanUpdateSchema,
} from "./planResult.js";

describe("split build schemas", () => {
  it("parses the season and first block as separate steps", () => {
    expect(seasonPlanUpdateSchema.parse({ season: makeSeason() })).toEqual({
      season: makeSeason(),
      bodyMetrics: [],
    });
    expect(initialBlockUpdateSchema.parse({ block: makeBlock() })).toEqual({
      block: makeBlock(),
      bodyMetrics: [],
    });
  });

  it("keeps the body metrics the coach found", () => {
    const parsed = seasonPlanUpdateSchema.parse({
      season: makeSeason(),
      bodyMetrics: [
        { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
      ],
    });

    expect(parsed.bodyMetrics).toEqual([
      { date: "2026-10-21", weightKg: 89.5, bodyFatPercent: 24.5 },
    ]);
  });

  it("defaults a body metric that gives only one value", () => {
    const parsed = seasonPlanUpdateSchema.parse({
      season: makeSeason(),
      bodyMetrics: [{ date: "2026-10-21", weightKg: 89.5 }],
    });

    expect(parsed.bodyMetrics[0]?.bodyFatPercent).toBeNull();
  });

  it("keeps the coach's introduction with the season", () => {
    const parsed = seasonPlanUpdateSchema.parse({ season: makeSeason() });

    expect(parsed.season.introduction).toBe(
      "Hello, I'm your coach. I'm looking forward to working with you.",
    );
  });

  it("requires the introduction when the season is first planned", () => {
    const { introduction, ...season } = makeSeason();
    void introduction;

    expect(() => seasonPlanUpdateSchema.parse({ season })).toThrow(
      "The season must open with",
    );
  });
});

describe("dailyPlanUpdateSchema", () => {
  it("parses a day and a revised week", () => {
    const parsed = dailyPlanUpdateSchema.parse({
      today: makeDay(undefined, {
        optional: true,
        optionalRationale: "Skip it if your legs are tired.",
      }),
      week: makeWeek(),
    });
    expect(parsed.today.alternatives).toEqual([]);
    expect(parsed.today.status).toBe("planned");
    expect(parsed.today.optional).toBe(true);
    expect(parsed.today.optionalRationale).toBe(
      "Skip it if your legs are tired.",
    );
    expect(parsed.week.sessions).toHaveLength(7);
  });

  it("rejects a day that is not one of the week's sessions", () => {
    expect(() =>
      dailyPlanUpdateSchema.parse({
        today: makeDay("2026-10-26"),
        week: makeWeek(),
      }),
    ).toThrow("Today's session must be one of the week's sessions");
  });
});

describe("weeklyPlanUpdateSchema", () => {
  it("parses the new week with its revised block", () => {
    const parsed = weeklyPlanUpdateSchema.parse({
      week: makeWeek(),
      block: makeBlock(),
    });

    expect(parsed.week.sessions).toHaveLength(7);
    expect(parsed.block.name).toBe("Base");
    expect(parsed.bodyMetrics).toEqual([]);
  });
});
