import { describe, expect, it } from "bun:test";
import { DEFAULT_DIET_GOAL } from "@killingit/shared";
import {
  missingFragments,
  promptRuleLiteral,
} from "../testFixtures/prompts.js";
import {
  ATHLETE_INPUT_RULES,
  COACH_AMBITION_RULES,
  ACTIVITY_FTP_ESTIMATE_RULES,
  COACH_ANALYSIS_RESPONSE_RULES,
  COACH_REPLY_RESPONSE_RULES,
  COACH_RESPONSE_NOTES_RULES,
  COMPLETED_SESSION_RULES,
  COMPLETION_SLACK_RULES,
  DAILY_HEALTH_RULES,
  DIET_PLANNING_RULES,
  DIET_PROGRESS_REPAIR_HINT,
  DIET_REPAIR_HINT,
  DIET_RULES,
  DURATION_TOLERANCE_RULES,
  GLOBAL_PROMPT_RULES,
  JSON_ONLY_RULES,
  JSON_RULES,
  PAST_SESSION_RULES,
  PLAN_CHANGE_FLAG_RULES,
  PLAN_PROMPT_RULES,
  rollExtraPraise,
  SEVEN_SESSIONS_CLAUSE,
  TEXT_FORMATTING_RULES,
  TRAINING_LOAD_RULES,
  TSS_ESTIMATE_GUIDE,
  weekCoverageRule,
  weekDatesRangeRule,
  weekDatesRule,
  WEEK_SHAPE_RULES,
} from "./promptRules.js";

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
    expect(DIET_PLANNING_RULES).toContain(DEFAULT_DIET_GOAL);
    expect(PLAN_PROMPT_RULES).toContain(DEFAULT_DIET_GOAL);
  });

  it("draws the extra praise for one review in fifteen", () => {
    expect(rollExtraPraise(() => 0)).toBe(true);
    expect(rollExtraPraise(() => 1 / 15)).toBe(false);
    expect(rollExtraPraise(() => 14 / 15)).toBe(false);
    expect(rollExtraPraise(() => 0.999999)).toBe(false);
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
});
