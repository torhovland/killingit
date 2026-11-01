import { describe, expect, it } from "bun:test";
import {
  COACH_RESPONSE_NOTES_CONTRACT,
  COACH_RESPONSE_NOTES_RULES,
  DURATION_TOLERANCE_RULES,
  SEASON_BLOCK_RULES,
  TODAY_SESSION_RULES,
  WEATHER_PLANNING_RULES,
} from "./promptRules.js";

describe("COACH_RESPONSE_NOTES_CONTRACT", () => {
  it("carries a single nullable question, not an array", () => {
    expect(COACH_RESPONSE_NOTES_CONTRACT).toContain(
      '"coachQuestion": "string | null"',
    );
    expect(COACH_RESPONSE_NOTES_CONTRACT).not.toContain("coachQuestions");
  });
});

describe("COACH_RESPONSE_NOTES_RULES", () => {
  it("asks for a single question or null", () => {
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "set it to null when nothing is needed",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "Ask at most one question per response",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "never one question per activity, day, week, block or season level",
    );
  });

  it("asks the question to name its context", () => {
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "specific and self-contained by naming the activity, date, week or metric",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain("12 October endurance ride");
  });

  it("does not treat normal missing input or an older activity as a problem", () => {
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "Do not report a normal or expected outcome as a remark",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "a measurement the athlete did not state",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "an activity outside the current week",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "a workout that could not be matched to a planned session",
    );
  });
});

describe("SEASON_BLOCK_RULES", () => {
  it("tiles the season without a shared or skipped day", () => {
    expect(SEASON_BLOCK_RULES).toContain(
      "each block starts the day after the previous block ends",
    );
    expect(SEASON_BLOCK_RULES).toContain(
      "no date belongs to two blocks and no date between blocks is left unplanned",
    );
  });

  it("shows a block ending on 2026-11-23 followed by one starting on 2026-11-24", () => {
    expect(SEASON_BLOCK_RULES).toContain(
      "Never start a block on the day the previous one ends",
    );
    expect(SEASON_BLOCK_RULES).toContain(
      "a block that ends on 2026-11-23 is followed by one that starts on 2026-11-24",
    );
  });

  it("anchors the first and last block to the season's dates", () => {
    expect(SEASON_BLOCK_RULES).toContain(
      "The first block starts on the season's start date and the last block ends on the season's end date.",
    );
  });
});

describe("DURATION_TOLERANCE_RULES", () => {
  it("treats a near-target duration in either direction as on plan", () => {
    expect(DURATION_TOLERANCE_RULES).toContain(
      "a two-hour session recorded as 1:50 or 2:05 matched its plan",
    );
    expect(DURATION_TOLERANCE_RULES).toContain(
      "Do not describe such a session as short or long",
    );
    expect(DURATION_TOLERANCE_RULES).toContain(
      "do not suggest changing the next session to make up for it",
    );
  });
});

describe("TODAY_SESSION_RULES", () => {
  it("keeps the planned workout and adds a short completion note", () => {
    expect(TODAY_SESSION_RULES).toContain(
      "keep that planned workout's title, description and rationale",
    );
    expect(TODAY_SESSION_RULES).toContain(
      "add one or two sentences to the end of the description",
    );
  });

  it("does not repeat the activity analysis on today's plan", () => {
    expect(TODAY_SESSION_RULES).toContain(
      "Do not summarise the activity again",
    );
    expect(TODAY_SESSION_RULES).toContain(
      "its own analysis and the coach's reply to the athlete's comment already cover it",
    );
  });

  it("replaces an earlier completion note instead of adding another", () => {
    expect(TODAY_SESSION_RULES).toContain(
      "replace only that note with an updated one",
    );
  });
});

describe("WEATHER_PLANNING_RULES", () => {
  it("lets an explicit request for a day outrank the forecast and a general weather preference", () => {
    expect(WEATHER_PLANNING_RULES).toContain(
      "An explicit request from the athlete about a specific day or activity outranks the forecast and their general weather preference",
    );
    expect(WEATHER_PLANNING_RULES).toContain(
      "if they say they will run outdoors on Saturday, plan an outdoor run on Saturday even when rain is forecast and they have said they avoid outdoor workouts in the rain",
    );
  });

  it("keeps the general weather preference for days without a specific request", () => {
    expect(WEATHER_PLANNING_RULES).toContain(
      "Their general weather preference applies to the days they have not made a specific request about",
    );
  });
});
