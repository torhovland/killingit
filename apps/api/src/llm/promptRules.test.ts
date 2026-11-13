import { describe, expect, it } from "bun:test";
import {
  ACTIVITY_EXTRA_PRAISE_RULES,
  ACTIVITY_PRAISE_RULES,
  ATHLETE_INPUT_RULES,
  COACH_AMBITION_RULES,
  COACH_ANALYSIS_CONTRACT,
  COACH_ANALYSIS_RESPONSE_RULES,
  COACH_PERSONALITY_RULES,
  COACH_REPLY_CONTRACT,
  COACH_REPLY_RESPONSE_RULES,
  COACH_RESPONSE_NOTES_CONTRACT,
  COACH_RESPONSE_NOTES_RULES,
  DIET_PROGRESS_REPAIR_HINT,
  DIET_REPAIR_HINT,
  PLAN_CHANGE_FLAG_RULES,
  DAY_CONTRACT,
  DIET_CONTRACT,
  DIET_PLANNING_RULES,
  DIET_PROGRESS_CONTRACT,
  DIET_PROGRESS_RULES,
  DURATION_TOLERANCE_RULES,
  EXTRA_PRAISE_DRAW_RANGE,
  FORM_TARGET_RULES,
  GLOBAL_PROMPT_RULES,
  PAST_SESSION_RULES,
  PLAN_PROMPT_RULES,
  rollExtraPraise,
  SEASON_BLOCK_RULES,
  SEASON_CONTRACT,
  SEASON_INTRODUCTION_RULES,
  SEVEN_SESSIONS_CLAUSE,
  TEXT_FORMATTING_RULES,
  TODAY_SESSION_RULES,
  TRAINING_LOAD_RULES,
  WEEK_CONTRACT,
  weekCoverageRule,
  weekDatesRangeRule,
  weekDatesRule,
  WEEK_OUTLINE_RULES,
  WEEK_SHAPE_RULES,
  WEATHER_PLANNING_RULES,
} from "./promptRules.js";

describe("PLAN_CHANGE_FLAG_RULES", () => {
  it("makes an input context only unless it changes what is prescribed", () => {
    expect(PLAN_CHANGE_FLAG_RULES).toContain(
      "changes what you would prescribe in the remaining season",
    );
    expect(PLAN_CHANGE_FLAG_RULES).toContain(
      "a workout that matched its prescription, praise or thanks",
    );
    expect(PLAN_CHANGE_FLAG_RULES).toContain(
      "a new constraint or commitment, an illness or injury",
    );
  });

  it("asks the coach to decide rather than follow a request", () => {
    expect(PLAN_CHANGE_FLAG_RULES).toContain(
      "The flag is a decision for you to make, not a report of whether the athlete asked for a change",
    );
  });

  it("appears in both contracts that carry the flag", () => {
    expect(COACH_ANALYSIS_RESPONSE_RULES).toContain(PLAN_CHANGE_FLAG_RULES);
    expect(COACH_REPLY_RESPONSE_RULES).toContain(PLAN_CHANGE_FLAG_RULES);
    expect(COACH_ANALYSIS_CONTRACT).toContain('"planChangeNeeded": false');
    expect(COACH_REPLY_CONTRACT).toContain('"planChangeNeeded": false');
  });
});

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

describe("COACH_PERSONALITY_RULES", () => {
  it("describes a tough but warm, relaxed and good-humoured coach", () => {
    expect(COACH_PERSONALITY_RULES).toContain(
      "tough but warm, relaxed, and good-humoured",
    );
    expect(COACH_PERSONALITY_RULES).toContain(
      "the training advice is always the point",
    );
  });

  it("keeps humour sparing and discreet", () => {
    expect(COACH_PERSONALITY_RULES).toContain(
      "use it sparingly and discreetly",
    );
    expect(COACH_PERSONALITY_RULES).toContain(
      "never let a joke replace the information or make the athlete feel small",
    );
  });

  it("never lets the coach call itself an AI", () => {
    expect(COACH_PERSONALITY_RULES).toContain(
      "Never describe yourself as an AI, an AI coach, a chatbot, a language model, an algorithm, or an app",
    );
  });

  it("allows pride and a trace of disappointment without overdoing it", () => {
    expect(COACH_PERSONALITY_RULES).toContain(
      "say so plainly and let your pride show",
    );
    expect(COACH_PERSONALITY_RULES).toContain(
      "a trace of disappointment is allowed",
    );
    expect(COACH_PERSONALITY_RULES).toContain("with no gushing and no sulking");
  });

  it("uses a real first name but never a non-name identifier", () => {
    expect(COACH_PERSONALITY_RULES).toContain(
      "plainly looks like a real first name, use it naturally now and then",
    );
    expect(COACH_PERSONALITY_RULES).toContain(
      "Never address the athlete with an email address, username, handle, account id, URL",
    );
    expect(COACH_PERSONALITY_RULES).toContain(
      "When no real first name is available, speak to them without one",
    );
  });

  it("reaches every prompt through the global rules", () => {
    expect(GLOBAL_PROMPT_RULES).toContain(COACH_PERSONALITY_RULES);
  });
});

describe("SEASON_INTRODUCTION_RULES", () => {
  it("asks a new season to introduce the coach and welcome the athlete", () => {
    expect(SEASON_INTRODUCTION_RULES).toContain(
      "greet the athlete by first name when the input gives a name that clearly looks like a real first name",
    );
    expect(SEASON_INTRODUCTION_RULES).toContain(
      "introduce yourself as the coach who will guide their season",
    );
    expect(SEASON_INTRODUCTION_RULES).toContain(
      "that is only one option, not a required line",
    );
    expect(SEASON_INTRODUCTION_RULES).toContain(
      "When no real first name is available, greet them without a name",
    );
    expect(SEASON_INTRODUCTION_RULES).toContain(
      "This greeting is not the season rationale",
    );
  });

  it("carries the greeting as a nullable field in the season contract", () => {
    expect(SEASON_CONTRACT).toContain('"introduction": "string | null"');
  });
});

describe("COACH_AMBITION_RULES", () => {
  it("asks for the most progress the athlete can absorb, not the safest plan", () => {
    expect(COACH_AMBITION_RULES).toContain(
      "Plan the most progress the athlete can absorb, not the safest plan you can defend",
    );
    expect(COACH_AMBITION_RULES).toContain("avoiding illness and injury");
    expect(COACH_AMBITION_RULES).toContain(
      "Do not make the plan timid to avoid every risk",
    );
    expect(COACH_AMBITION_RULES).toContain(
      "do not take risks the data does not support",
    );
  });
});

describe("ATHLETE_INPUT_RULES", () => {
  it("accommodates a workout the athlete says they will do", () => {
    expect(ATHLETE_INPUT_RULES).toContain(
      "such as a three-hour group ride on Sunday",
    );
    expect(ATHLETE_INPUT_RULES).toContain(
      "plan around that commitment and keep it in the plan",
    );
    expect(ATHLETE_INPUT_RULES).toContain(
      "say so briefly in that day's description instead of silently replacing it",
    );
  });

  it("treats feedback about how the athlete feels as information, not an instruction", () => {
    expect(ATHLETE_INPUT_RULES).toContain(
      "a niggle, a pain, a poor night's sleep",
    );
    expect(ATHLETE_INPUT_RULES).toContain(
      "not as an instruction to change the plan",
    );
    expect(ATHLETE_INPUT_RULES).toContain(
      "may justify an easier session, extra rest, or no change at all",
    );
    expect(ATHLETE_INPUT_RULES).toContain(
      "never change the plan only because the athlete mentioned a discomfort",
    );
  });

  it("leaves the decision with the coach", () => {
    expect(ATHLETE_INPUT_RULES).toContain("You are the expert");
    expect(ATHLETE_INPUT_RULES).toContain(
      "read it together with the training data, the recovery values and the plan",
    );
    expect(ATHLETE_INPUT_RULES).toContain("Never ignore a warning sign");
  });

  it("reaches every plan prompt through the shared plan rules", () => {
    expect(PLAN_PROMPT_RULES).toContain(COACH_AMBITION_RULES);
    expect(PLAN_PROMPT_RULES).toContain(ATHLETE_INPUT_RULES);
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

describe("week dates fragments", () => {
  it("names the seven dates of the week from its start date", () => {
    expect(weekDatesRule("2026-10-26")).toBe(
      "The week must start on 2026-10-26 and contain exactly seven sessions dated 2026-10-26, 2026-10-27, 2026-10-28, 2026-10-29, 2026-10-30, 2026-10-31, 2026-11-01",
    );
  });

  it("names the week the sentence is about", () => {
    expect(weekDatesRule("2026-10-26", "next week")).toBe(
      "The next week must start on 2026-10-26 and contain exactly seven sessions dated 2026-10-26, 2026-10-27, 2026-10-28, 2026-10-29, 2026-10-30, 2026-10-31, 2026-11-01",
    );
  });

  it("states the same rule as a range of dates", () => {
    expect(weekCoverageRule("2026-10-26")).toBe(
      "The week must start on 2026-10-26 and cover 2026-10-26 through 2026-11-01. Keep exactly seven sessions with those dates",
    );
    expect(weekCoverageRule("2026-10-26", "current week")).toContain(
      "The current week must start on 2026-10-26",
    );
    expect(weekDatesRangeRule("2026-10-26")).toBe(
      "The week must contain exactly seven sessions dated 2026-10-26 through 2026-11-01",
    );
  });

  it("states the session count one way everywhere", () => {
    expect(WEEK_SHAPE_RULES).toContain(SEVEN_SESSIONS_CLAUSE);
    expect(weekDatesRule("2026-10-26")).toContain(SEVEN_SESSIONS_CLAUSE);
    expect(weekCoverageRule("2026-10-26")).toContain(SEVEN_SESSIONS_CLAUSE);
    expect(weekDatesRangeRule("2026-10-26")).toContain(SEVEN_SESSIONS_CLAUSE);
  });
});

describe("diet repair hints", () => {
  it("names the diet goal fields and the progress target fields", () => {
    expect(DIET_REPAIR_HINT).toBe(
      '"diet" with "goal", "goalProvided" and "assessment"',
    );
    expect(DIET_PROGRESS_REPAIR_HINT).toBe(
      'a "dietProgress" object with "targetWeightKg", "targetBodyFatPercent" and "note"',
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

describe("ACTIVITY_PRAISE_RULES", () => {
  it("praises a well-performed race or extraordinary effort", () => {
    expect(ACTIVITY_PRAISE_RULES).toContain(
      "When the workout was a race, or an effort far above the athlete's ordinary training",
    );
    expect(ACTIVITY_PRAISE_RULES).toContain(
      "tell them plainly that they are killing it",
    );
    expect(ACTIVITY_PRAISE_RULES).toContain(
      'Use the words "killing it" exactly',
    );
  });

  it("extends the praise to any well-executed workout only in the occasional review", () => {
    expect(ACTIVITY_EXTRA_PRAISE_RULES).toContain(
      "even though it was not a race or an effort far above their ordinary training",
    );
    expect(ACTIVITY_EXTRA_PRAISE_RULES).toContain(
      "if this session was well executed, tell the athlete they are killing it",
    );
    expect(ACTIVITY_EXTRA_PRAISE_RULES).toContain(
      "Do not force it when the session went poorly",
    );
  });
});

describe("rollExtraPraise", () => {
  it("includes the extra praise only for a draw of 0", () => {
    expect(EXTRA_PRAISE_DRAW_RANGE).toBe(15);
    expect(rollExtraPraise(() => 0)).toBe(true);
    expect(rollExtraPraise(() => 1 / EXTRA_PRAISE_DRAW_RANGE)).toBe(false);
    expect(rollExtraPraise(() => 14 / EXTRA_PRAISE_DRAW_RANGE)).toBe(false);
    expect(rollExtraPraise(() => 0.999999)).toBe(false);
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

  it("asks for the breakdown and says the parts start rough", () => {
    expect(DIET_PLANNING_RULES).toContain('"calorieBreakdown"');
    expect(DIET_PLANNING_RULES).toContain('"basalMetabolismKcal"');
    expect(DIET_PLANNING_RULES).toContain('"workoutCaloriesKcal"');
    expect(DIET_PLANNING_RULES).toContain('"dietDeficitKcal"');
    expect(DIET_PLANNING_RULES).toContain("plus the workout requirement minus");
    expect(DIET_PLANNING_RULES).toContain("rough when you know little");
    expect(DIET_PLANNING_RULES).toContain("As meals and weigh-ins accumulate");
    expect(DAY_CONTRACT).toContain('"calorieBreakdown"');
    expect(WEEK_CONTRACT).toContain('"calorieBreakdown"');
  });

  it("keeps a deficit in a fat-loss plan even with little data", () => {
    expect(DIET_PLANNING_RULES).toContain("always calls for a calorie deficit");
    expect(DIET_PLANNING_RULES).toContain(
      "never a reason to allocate maintenance calories",
    );
    expect(DIET_PLANNING_RULES).toContain("200-500 kcal per day");
    expect(DIET_PLANNING_RULES).toContain(
      "A body-fat goal does not need a separate weight target",
    );
    expect(DIET_PLANNING_RULES).toContain(
      "race preparation changes the size and timing of the deficit",
    );
    expect(DIET_PLANNING_RULES).toContain(
      "it stays above 0 on the days you allocate",
    );
  });

  it("records whether the athlete stated the goal", () => {
    expect(DIET_PLANNING_RULES).toContain('"diet.goalProvided"');
    expect(DIET_PLANNING_RULES).toContain(
      "true only when the athlete stated the goal themselves",
    );
    expect(DIET_CONTRACT).toContain('"goalProvided": false');
  });

  it("reads the numeric goal and date without inventing one", () => {
    expect(DIET_PLANNING_RULES).toContain('"diet.goalWeightKg"');
    expect(DIET_PLANNING_RULES).toContain('"diet.goalBodyFatPercent"');
    expect(DIET_PLANNING_RULES).toContain('"diet.goalDate"');
    expect(DIET_PLANNING_RULES).toContain("Never invent a target or a date");
    expect(DIET_CONTRACT).toContain('"goalBodyFatPercent": 0');
    expect(DIET_CONTRACT).toContain('"goalWeightKg": 0');
    expect(DIET_CONTRACT).toContain('"goalDate": "YYYY-MM-DD"');
    expect(DIET_CONTRACT).toContain('"goalMissReason": "string"');
  });
});

describe("DIET_PROGRESS_RULES", () => {
  it("plans a target at every period end", () => {
    expect(DIET_PROGRESS_RULES).toContain('"dietProgress"');
    expect(DIET_PROGRESS_RULES).toContain("on the season");
    expect(DIET_PROGRESS_RULES).toContain("on each season block");
    expect(DIET_PROGRESS_RULES).toContain("on the block");
    expect(DIET_PROGRESS_RULES).toContain("on each block week");
    expect(DIET_PROGRESS_RULES).toContain("on the week");
    expect(DIET_PROGRESS_RULES).toContain('"targetWeightKg"');
    expect(DIET_PROGRESS_RULES).toContain('"targetBodyFatPercent"');
  });

  it("does not force a linear weekly change", () => {
    expect(DIET_PROGRESS_RULES).toContain(
      "Progress is not a linear week-by-week formula",
    );
    expect(DIET_PROGRESS_RULES).toContain("block that builds muscle");
    expect(DIET_PROGRESS_RULES).toContain("may hold weight or gain slightly");
    expect(DIET_PROGRESS_RULES).toContain(
      "match every target to the block's focus and the training load",
    );
  });

  it("checks a mid-season goal at its own date and allows a deliberate miss", () => {
    expect(DIET_PROGRESS_RULES).toContain(
      "The target at the goal date is the destination",
    );
    expect(DIET_PROGRESS_RULES).toContain(
      "The season-end target may then be above a mid-season goal",
    );
    expect(DIET_PROGRESS_RULES).toContain(
      "A goal date after the season ends is not due in this season",
    );
    expect(DIET_PROGRESS_RULES).toContain(
      "A plan that misses the goal is not automatically wrong",
    );
    expect(DIET_PROGRESS_RULES).toContain('"diet.goalMissReason"');
    expect(DIET_PROGRESS_RULES).toContain(
      "Do not use a miss reason as a blanket excuse to avoid loss",
    );
    expect(DIET_PROGRESS_RULES).toContain("Front-load the change");
    expect(DIET_PROGRESS_RULES).toContain(
      "Holding weight at a high body-fat percentage for most of the season is not a plan to lose fat",
    );
    expect(DIET_PROGRESS_RULES).toContain("stays near 24%");
    expect(DIET_PROGRESS_RULES).toContain(
      "do not repeat the previous block's target for block after block",
    );
  });

  it("re-plans from the latest measurements instead of an old target", () => {
    expect(DIET_PROGRESS_RULES).toContain(
      "re-plan the targets for the levels you return from the latest measurement",
    );
    expect(DIET_PROGRESS_RULES).toContain(
      "ahead of or behind an earlier target",
    );
    expect(DIET_PROGRESS_RULES).toContain(
      "A plan update always refreshes the targets on every level it returns",
    );
    expect(DIET_PROGRESS_RULES).toContain(
      "the app never calculates a deficit, a rate of change, or a target",
    );
  });

  it("leaves every target null without diet advice or a stated goal", () => {
    expect(DIET_PROGRESS_RULES).toContain(
      "When diet advice is disabled, or when the athlete has stated no diet goal",
    );
    expect(DIET_PROGRESS_RULES).toContain('set every "dietProgress" to null');
  });

  it("reaches every plan prompt through the shared plan rules", () => {
    expect(PLAN_PROMPT_RULES).toContain(DIET_PROGRESS_RULES);
  });

  it("describes the target in the shared contract", () => {
    expect(DIET_PROGRESS_CONTRACT).toContain('"targetWeightKg": 0');
    expect(DIET_PROGRESS_CONTRACT).toContain('"targetBodyFatPercent": 0');
    expect(DIET_PROGRESS_CONTRACT).toContain('"note": "string"');
  });
});
