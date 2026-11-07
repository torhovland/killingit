import { describe, expect, it } from "bun:test";
import {
  COACH_RESPONSE_NOTES_CONTRACT,
  COACH_RESPONSE_NOTES_RULES,
  DIET_PLANNING_RULES,
  DURATION_TOLERANCE_RULES,
  FORM_TARGET_RULES,
  PAST_SESSION_RULES,
  PLAN_PROMPT_RULES,
  SEASON_BLOCK_RULES,
  TEXT_FORMATTING_RULES,
  TODAY_SESSION_RULES,
  TRAINING_LOAD_RULES,
  WEEK_OUTLINE_RULES,
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

  it("keeps the athlete's units when a question mentions a measurement", () => {
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      "use the unit and wording the athlete used and never convert it",
    );
    expect(COACH_RESPONSE_NOTES_RULES).toContain(
      'ask about "5:46 per km", not "346 seconds per kilometre"',
    );
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

describe("TEXT_FORMATTING_RULES", () => {
  it("asks for paragraphs, bullets and numbered items", () => {
    expect(TEXT_FORMATTING_RULES).toContain(
      "Separate paragraphs with a blank line",
    );
    expect(TEXT_FORMATTING_RULES).toContain(
      'Start each bullet on its own line with "- "',
    );
    expect(TEXT_FORMATTING_RULES).toContain(
      'Start each numbered item on its own line with "1. ", "2. ", and so on',
    );
  });

  it("asks for structure in long coach text and bans other markdown", () => {
    expect(TEXT_FORMATTING_RULES).toContain(
      "a workout's description, a plan's rationale, a review, an activity analysis, or a coach reply",
    );
    expect(TEXT_FORMATTING_RULES).toContain(
      "Do not use headings, bold, italics, links, tables or code blocks",
    );
    expect(TEXT_FORMATTING_RULES).toContain(
      "Keep short fields — a session's title, a plan's focus and a block's name — as short plain phrases",
    );
  });

  it("reaches every plan prompt through the shared plan rules", () => {
    expect(PLAN_PROMPT_RULES).toContain(TEXT_FORMATTING_RULES);
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

describe("PAST_SESSION_RULES", () => {
  it("keeps the planned week outline and settles the status", () => {
    expect(PAST_SESSION_RULES).toContain(
      "keep the planned week outline for each day",
    );
    expect(PAST_SESSION_RULES).toContain(
      'set its status to "completed", "partial", "missed", or "rest"',
    );
    expect(PAST_SESSION_RULES).not.toContain(
      "describe what the athlete actually did",
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
    expect(WEEK_OUTLINE_RULES).toContain(
      "do not replace the outline with an activity summary",
    );
  });
});

describe("FORM_TARGET_RULES", () => {
  it("names the TSB bands and makes Productive the default target", () => {
    expect(FORM_TARGET_RULES).toContain(
      "TSB between -30 and -10 is Productive",
    );
    expect(FORM_TARGET_RULES).toContain(
      "Keep the planned week's projected TSB inside Productive by default",
    );
  });

  it("allows a justified recovery, taper or overload to leave Productive", () => {
    expect(FORM_TARGET_RULES).toContain(
      "A recovery or taper week may move TSB into Fresh",
    );
    expect(FORM_TARGET_RULES).toContain(
      "a deliberate overload may briefly enter Risk",
    );
    expect(FORM_TARGET_RULES).toContain(
      "state that reason in the week's rationale",
    );
  });

  it("reaches every plan prompt through the shared training-load rules", () => {
    expect(TRAINING_LOAD_RULES).toContain(FORM_TARGET_RULES);
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

describe("DIET_PLANNING_RULES", () => {
  it("assumes maintenance when the athlete states no diet goal", () => {
    expect(DIET_PLANNING_RULES).toContain(
      "assume the goal is to maintain their current weight",
    );
    expect(DIET_PLANNING_RULES).toContain("Maintain current weight");
  });

  it("has the coach judge the weight trend instead of the app computing it", () => {
    expect(DIET_PLANNING_RULES).toContain(
      "judge from the tracked weight history",
    );
    expect(DIET_PLANNING_RULES).toContain("rather than from a fixed formula");
  });

  it("asks for a per-day calorie estimate on every week and day plan", () => {
    expect(DIET_PLANNING_RULES).toContain("estimatedCaloriesKcal");
    expect(DIET_PLANNING_RULES).toContain(
      "every week session and on the today and tomorrow day objects",
    );
    expect(DIET_PLANNING_RULES).toContain("Never return 0");
  });
});
