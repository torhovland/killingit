import { describe, expect, it } from "bun:test";
import {
  COACH_RESPONSE_NOTES_RULES,
  WEATHER_PLANNING_RULES,
} from "./promptRules.js";

describe("COACH_RESPONSE_NOTES_RULES", () => {
  it("asks for at most one question per response", () => {
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
