import { describe, expect, it } from "bun:test";
import {
  COACH_RESPONSE_NOTES_RULES,
  PERIOD_SUMMARY_RULES,
  TODAY_SESSION_RULES,
  WEEK_OUTLINE_RULES,
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

describe("WEEK_OUTLINE_RULES", () => {
  it("keeps the detailed prescription in the day objects", () => {
    expect(WEEK_OUTLINE_RULES).toContain(
      'Keep the detailed prescription, including alternatives, optionality, rationale and any "bikeWorkout", in the "today" and "tomorrow" day objects only',
    );
    expect(WEEK_OUTLINE_RULES).toContain(
      'never put detailed intervals, repetitions, paces, power targets or a "bikeWorkout" in a week session, even when it is dated today or tomorrow',
    );
  });

  it("adds only a completion sentence to a week outline for a day that arrived", () => {
    expect(WEEK_OUTLINE_RULES).toContain(
      "keep its week outline and add at most one short sentence to its description on how far the athlete completed it",
    );
  });
});

describe("PERIOD_SUMMARY_RULES", () => {
  it("keeps block weeks and season blocks planned", () => {
    expect(PERIOD_SUMMARY_RULES).toContain(
      "keep them as planned rather than replacing them with an analysis of the training that was completed",
    );
  });

  it("allows one completion sentence and points to the separate review", () => {
    expect(PERIOD_SUMMARY_RULES).toContain(
      "keep the planned focus and target load as supplied and add at most one short sentence on how far the athlete completed it",
    );
    expect(PERIOD_SUMMARY_RULES).toContain(
      "Do not repeat the completed week or block review",
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
