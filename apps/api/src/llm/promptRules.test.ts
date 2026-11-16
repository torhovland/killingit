import { describe, expect, it } from "bun:test";
import { DEFAULT_DIET_GOAL } from "@killingit/shared";
import {
  missingFragments,
  promptRuleLiteral,
} from "../testFixtures/prompts.js";
import type { LlmProviderMessage } from "./openrouter.js";
import {
  ATHLETE_INPUT_RULES,
  COACH_AMBITION_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  COACH_ANALYSIS_RESPONSE_RULES,
  COACH_REPLY_RESPONSE_RULES,
  COACH_RESPONSE_NOTES_RULES,
  COACHING_SURVEY_ADJUSTMENT_RULES,
  COMPLETED_SESSION_RULES,
  COMPLETION_SLACK_RULES,
  DAILY_HEALTH_RULES,
  DIET_PROGRESS_REPAIR_HINT,
  DIET_REPAIR_HINT,
  DIET_RULES,
  DURATION_TOLERANCE_RULES,
  FOOD_ANALYSIS_RESPONSE_RULES,
  GLOBAL_PROMPT_RULES,
  JSON_ONLY_RULES,
  JSON_RULES,
  jsonShape,
  missingDietGoalMessage,
  missingDietProgressMessage,
  PAST_SESSION_RULES,
  PLAN_CHANGE_FLAG_RULES,
  PLAN_PROMPT_RULES,
  PLAN_UPDATE_SHARED_RULES,
  rollExtraPraise,
  SESSION_PURPOSE_RULES,
  SEVEN_SESSIONS_CLAUSE,
  systemUserMessages,
  TEXT_FORMATTING_RULES,
  TRAINING_LOAD_RULES,
  TSS_ESTIMATE_GUIDE,
  weekCoverageRule,
  weekDatesRangeRule,
  weekDatesRule,
  WEEK_SHAPE_RULES,
} from "./promptRules.js";

/**
 * The diet planning rule as a prompt receives it. Its source interpolates the
 * default goal, so the fixture's raw literal has to resolve it before it can be
 * matched against a rendered prompt.
 */
const DIET_PLANNING_PROMPT = promptRuleLiteral(
  "DIET_PLANNING_RULES",
).replaceAll("${DEFAULT_DIET_GOAL}", DEFAULT_DIET_GOAL);

describe("shared prompt composition", () => {
  it("builds the global rules from the coach personality", () => {
    expect(
      missingFragments(GLOBAL_PROMPT_RULES, [
        promptRuleLiteral("COACH_PERSONALITY_RULES"),
      ]),
    ).toEqual([]);
  });

  it("builds the plan rules from the fragments every plan prompt needs", () => {
    expect(
      missingFragments(PLAN_PROMPT_RULES, [
        COACH_AMBITION_RULES,
        ATHLETE_INPUT_RULES,
        promptRuleLiteral("ATHLETE_EVENT_RULES"),
        DAILY_HEALTH_RULES,
        DIET_RULES,
        TEXT_FORMATTING_RULES,
      ]),
    ).toEqual([]);
  });

  it("builds the completed-session rules in the order a prompt reads them", () => {
    const todayRules = promptRuleLiteral("TODAY_SESSION_RULES");
    expect(
      missingFragments(COMPLETED_SESSION_RULES, [
        PAST_SESSION_RULES,
        todayRules,
        COMPLETION_SLACK_RULES,
      ]),
    ).toEqual([]);
    expect(
      missingFragments(COMPLETION_SLACK_RULES, [DURATION_TOLERANCE_RULES]),
    ).toEqual([]);
    expect(COMPLETED_SESSION_RULES.indexOf(PAST_SESSION_RULES)).toBeLessThan(
      COMPLETED_SESSION_RULES.indexOf(todayRules),
    );
  });

  it("builds the training-load rules from the estimate and form fragments", () => {
    expect(
      missingFragments(TRAINING_LOAD_RULES, [
        promptRuleLiteral("ACTIVITY_DATA_LIMITS_RULE"),
        TSS_ESTIMATE_GUIDE,
        promptRuleLiteral("FORM_TARGET_RULES"),
      ]),
    ).toEqual([]);
  });

  it("builds the update tail from the seven shared rules in order", () => {
    const tail = PLAN_UPDATE_SHARED_RULES();
    const order = [
      promptRuleLiteral("WEEK_OUTLINE_RULES"),
      promptRuleLiteral("WEATHER_PLANNING_RULES"),
      promptRuleLiteral("BIKE_WORKOUT_RULES"),
      DIET_PLANNING_PROMPT,
      TRAINING_LOAD_RULES,
      promptRuleLiteral("ENUM_RULES"),
      JSON_RULES,
    ];
    expect(missingFragments(tail, order)).toEqual([]);
    const positions = order.map((fragment) => tail.indexOf(fragment));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("places a prompt's own rules inside the tail where it reads them", () => {
    const tail = PLAN_UPDATE_SHARED_RULES([
      SESSION_PURPOSE_RULES,
      COACHING_SURVEY_ADJUSTMENT_RULES,
    ]);
    const positions = [
      promptRuleLiteral("WEEK_OUTLINE_RULES"),
      SESSION_PURPOSE_RULES,
      COACHING_SURVEY_ADJUSTMENT_RULES,
      promptRuleLiteral("WEATHER_PLANNING_RULES"),
    ].map((fragment) => tail.indexOf(fragment));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("builds the activity FTP estimate from the activity data limits", () => {
    expect(
      missingFragments(ACTIVITY_FTP_ESTIMATE_RULES, [
        promptRuleLiteral("ACTIVITY_DATA_LIMITS_RULE"),
      ]),
    ).toEqual([]);
  });

  it("builds the JSON rules from the output and coach-notes rules", () => {
    expect(
      missingFragments(JSON_RULES, [
        JSON_ONLY_RULES,
        COACH_RESPONSE_NOTES_RULES,
      ]),
    ).toEqual([]);
  });

  it("asks for one JSON object with the contract's shape", () => {
    const instruction = promptRuleLiteral("JSON_SHAPE_INSTRUCTION");
    expect(jsonShape(`{ "tss": 0 }`)).toBe(`${instruction}:\n{ "tss": 0 }`);
    expect(jsonShape()).toBe(`${instruction}.`);
  });

  it("opens every JSON response with the same shape instruction", () => {
    const instruction = promptRuleLiteral("JSON_SHAPE_INSTRUCTION");
    for (const rules of [
      JSON_RULES,
      COACH_ANALYSIS_RESPONSE_RULES,
      COACH_REPLY_RESPONSE_RULES,
      FOOD_ANALYSIS_RESPONSE_RULES,
    ]) {
      expect(rules).toContain(instruction);
    }
  });

  it("builds the analysis and reply response rules from the shared decisions", () => {
    expect(
      missingFragments(COACH_ANALYSIS_RESPONSE_RULES, [
        PLAN_CHANGE_FLAG_RULES,
        COACH_RESPONSE_NOTES_RULES,
        JSON_ONLY_RULES,
      ]),
    ).toEqual([]);
    expect(
      missingFragments(COACH_REPLY_RESPONSE_RULES, [
        PLAN_CHANGE_FLAG_RULES,
        JSON_ONLY_RULES,
      ]),
    ).toEqual([]);
  });

  it("names the default diet goal in the plan rules", () => {
    expect(DIET_PLANNING_PROMPT).toContain(DEFAULT_DIET_GOAL);
    expect(PLAN_PROMPT_RULES).toContain(DEFAULT_DIET_GOAL);
  });

  it("draws the extra praise for one review in fifteen", () => {
    expect(rollExtraPraise(() => 0)).toBe(true);
    expect(rollExtraPraise(() => 1 / 15)).toBe(false);
    expect(rollExtraPraise(() => 14 / 15)).toBe(false);
    expect(rollExtraPraise(() => 0.999999)).toBe(false);
  });

  it("builds the two text messages every prompt sends", () => {
    expect(systemUserMessages("the rules", "the context")).toEqual([
      { role: "system", content: "the rules" },
      { role: "user", content: "the context" },
    ]);
  });

  it("assigns a prompt message to the provider's message type", () => {
    const providerMessages: LlmProviderMessage[] = systemUserMessages(
      "the rules",
      "the context",
    );

    expect(providerMessages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
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
  it("names the diet goal fields", () => {
    for (const field of ["goal", "goalProvided", "assessment"]) {
      expect(DIET_REPAIR_HINT).toContain(`"${field}"`);
    }
  });

  it("names the progress target fields", () => {
    for (const field of ["targetWeightKg", "targetBodyFatPercent", "note"]) {
      expect(DIET_PROGRESS_REPAIR_HINT).toContain(`"${field}"`);
    }
  });

  it("names the goal fields in the missing-goal message", () => {
    expect(missingDietGoalMessage()).toBe(
      `Missing the diet goal. Return ${DIET_REPAIR_HINT}.`,
    );
  });

  it("names the period and progress fields in the missing-target message", () => {
    expect(missingDietProgressMessage("the current week")).toBe(
      `Missing the diet progress target for the current week. Return ${DIET_PROGRESS_REPAIR_HINT}.`,
    );
  });
});
