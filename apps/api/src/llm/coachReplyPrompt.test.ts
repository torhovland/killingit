import { describe, expect, it } from "bun:test";
import type { CoachPlan } from "@killingit/shared";
import {
  buildCoachReplyMessages,
  buildCoachReplyPrompt,
} from "./coachReplyPrompt.js";

function makePlan(): CoachPlan {
  return {
    season: {
      goal: "Sub-4-hour marathon",
      startDate: "2026-10-19",
      endDate: "2027-04-01",
      rationale: "Build aerobic base.",
      blocks: [
        {
          name: "Base",
          focus: "Aerobic endurance",
          startDate: "2026-10-19",
          endDate: "2026-12-01",
          weekCount: 6,
        },
      ],
    },
    block: {
      name: "Base",
      focus: "Aerobic endurance",
      rationale: "Establish consistent volume.",
      startDate: "2026-10-19",
      endDate: "2026-12-01",
      weeks: [
        {
          number: 1,
          startDate: "2026-10-19",
          focus: "Aerobic base",
          targetLoad: "Easy",
        },
      ],
    },
    week: {
      startDate: "2026-10-19",
      focus: "Aerobic base",
      rationale: "Keep the week easy.",
      sessions: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(19 + index)}`,
        day: "Monday",
        type: "workout" as const,
        title: index === 3 ? "Threshold intervals" : "Easy run",
        description: "Aerobic work.",
        durationMinutes: 45,
        intensity: "easy" as const,
        status: "planned" as const,
      })),
    },
    today: {
      date: "2026-10-21",
      type: "workout",
      title: "Easy run",
      description: "45 minutes easy.",
      durationMinutes: 45,
      intensity: "easy",
      alternatives: [],
      rationale: "Easy aerobic work.",
      optional: false,
      status: "planned",
    },
    tomorrow: null,
  };
}

const answers = [
  { prompt: "What is your goal?", answer: "Run a marathon.", skipped: false },
];

describe("buildCoachReplyMessages", () => {
  it("describes a weekly note and the week it applies to", () => {
    const prompt = buildCoachReplyPrompt({
      today: "2026-10-21",
      plan: makePlan(),
      athleteAnswers: answers,
      request: {
        kind: "weekly_note",
        weekStartDate: "2026-10-19",
        note: "I cannot train on Thursday this week.",
      },
    });

    expect(prompt).toContain("Run a marathon.");
    expect(prompt).toContain("Weekly note for the week starting 2026-10-19");
    expect(prompt).toContain("I cannot train on Thursday this week.");
    expect(prompt).toContain("Today's session:");
    expect(prompt).toContain("Write your brief reply");
  });

  it("says today's session will not change when the input is about today", () => {
    const prompt = buildCoachReplyPrompt({
      today: "2026-10-21",
      plan: makePlan(),
      athleteAnswers: answers,
      request: {
        kind: "manual_activity",
        startDate: "2026-10-21",
        details: "Pool swim",
      },
    });

    expect(prompt).toContain("Manual activity on 2026-10-21");
    expect(prompt).toContain("Today's session has already happened");
  });

  it("answers a by-the-way question without changing the plan", () => {
    const messages = buildCoachReplyMessages({
      today: "2026-10-21",
      plan: makePlan(),
      athleteAnswers: answers,
      request: {
        kind: "quick_question",
        question: "Should I run on Saturday or Sunday?",
      },
    });

    expect(messages[1]?.content).toContain(
      'Question: "Should I run on Saturday or Sunday?"',
    );
    expect(messages[1]?.content).toContain(
      "It is not stored and does not change the plan",
    );
    expect(messages[0]?.content).toContain("This is a conversation only");
  });

  it("uses a brief plain-text reply system prompt", () => {
    const messages = buildCoachReplyMessages({
      today: "2026-10-21",
      plan: makePlan(),
      athleteAnswers: answers,
      request: {
        kind: "activity_comment",
        activityDate: "2026-10-20",
        comment: "Felt strong on the hills.",
      },
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Reply briefly in 1-2 sentences");
    expect(messages[0]?.content).toContain(
      "do not use headings, bullets, or markdown",
    );
  });
});
