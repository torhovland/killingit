import { describe, expect, it } from "bun:test";
import {
  makeActivitySummary,
  makeDay,
  makePlan,
  makeWeek,
  PLAN_TODAY,
  PLAN_WEEK_START,
} from "../testFixtures/plan.js";
import {
  buildCoachReplyMessages,
  buildCoachReplyPrompt,
  type CoachReplyPromptInput,
} from "./coachReplyPrompt.js";
import type { PlanContextInput } from "./planContext.js";
import {
  ATHLETE_INPUT_RULES,
  COACH_AMBITION_RULES,
  GLOBAL_PROMPT_RULES,
  REPLY_PLAN_CHANGE_RULES,
  TEXT_FORMATTING_RULES,
} from "./promptRules.js";

const plan = makePlan({
  week: makeWeek(PLAN_WEEK_START, {
    sessions: makeWeek(PLAN_WEEK_START).sessions.map((session, index) =>
      index === 3 ? { ...session, title: "Threshold intervals" } : session,
    ),
  }),
  today: makeDay(PLAN_TODAY, {
    weather: {
      date: PLAN_TODAY,
      icon: "partly_cloudy",
      temperatureMinC: 8,
      temperatureMaxC: 14,
      windMaxMs: 4,
      gustMaxMs: 7,
      precipitationMm: 0.2,
      sunrise: "07:42",
      sunset: "17:55",
    },
  }),
});

function makeContext(
  overrides: Partial<PlanContextInput> = {},
): PlanContextInput {
  return {
    today: "2026-10-21",
    athleteAnswers: [
      {
        prompt: "What is your goal?",
        answer: "Run a marathon.",
        skipped: false,
      },
    ],
    recentActivities: [],
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<CoachReplyPromptInput> = {},
): CoachReplyPromptInput {
  return {
    plan,
    context: makeContext(),
    request: { kind: "quick_question", question: "Should I ride today?" },
    ...overrides,
  };
}

describe("buildCoachReplyMessages", () => {
  it("includes the completed week summary when replying to its review", () => {
    const prompt = buildCoachReplyPrompt(
      makeInput({
        request: {
          kind: "week_review",
          startDate: "2026-10-13",
          endDate: "2026-10-19",
          summary: "You completed five of six sessions.",
          comment: "I felt strong all week.",
        },
      }),
    );

    expect(prompt).toContain("Coach summary of the completed week");
    expect(prompt).toContain("You completed five of six sessions.");
    expect(prompt).toContain("I felt strong all week.");
  });

  it("describes a weekly note and the week it applies to", () => {
    const prompt = buildCoachReplyPrompt(
      makeInput({
        request: {
          kind: "weekly_note",
          weekStartDate: "2026-10-19",
          note: "I cannot train on Thursday this week.",
        },
      }),
    );

    expect(prompt).toContain("Run a marathon.");
    expect(prompt).toContain("Weekly note for the week starting 2026-10-19");
    expect(prompt).toContain("I cannot train on Thursday this week.");
    expect(prompt).toContain("Today's session:");
    expect(prompt).toContain("Write your brief reply");
  });

  it("says today's session will not change when the input is about today", () => {
    const prompt = buildCoachReplyPrompt(
      makeInput({
        request: {
          kind: "manual_activity",
          startDate: "2026-10-21",
          details: "Pool swim",
        },
      }),
    );

    expect(prompt).toContain("Manual activity on 2026-10-21");
    expect(prompt).toContain("Today's session has already happened");
  });

  it("answers a by-the-way question without changing the plan", () => {
    const messages = buildCoachReplyMessages(
      makeInput({
        request: {
          kind: "quick_question",
          question: "Should I run on Saturday or Sunday?",
        },
      }),
    );

    expect(messages[1]?.content).toContain(
      'Question: "Should I run on Saturday or Sunday?"',
    );
    expect(messages[1]?.content).toContain(
      "It is not stored and does not change the plan",
    );
    expect(messages[0]?.content).toContain("This is a conversation only");
  });

  it("uses a brief plain-text reply system prompt", () => {
    const messages = buildCoachReplyMessages(
      makeInput({
        request: {
          kind: "activity_comment",
          activityDate: "2026-10-20",
          comment: "Felt strong on the hills.",
        },
      }),
    );

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Reply briefly in 1-2 sentences");
    expect(messages[0]?.content).toContain(TEXT_FORMATTING_RULES);
    expect(messages[0]?.content).toContain(GLOBAL_PROMPT_RULES);
    expect(messages[0]?.content).toContain(COACH_AMBITION_RULES);
    expect(messages[0]?.content).toContain(ATHLETE_INPUT_RULES);
  });

  it("says whether the plan changes instead of always promising one", () => {
    const messages = buildCoachReplyMessages(
      makeInput({
        request: {
          kind: "activity_comment",
          activityDate: "2026-10-20",
          comment: "Felt strong on the hills.",
        },
      }),
    );

    expect(messages[0]?.content).toContain(REPLY_PLAN_CHANGE_RULES);
    expect(messages[0]?.content).not.toContain(
      "explain how it affects the plan",
    );
  });
});

describe("buildCoachReplyPrompt training context", () => {
  it("shows the recent activities, their analyses and the athlete's comments", () => {
    const prompt = buildCoachReplyPrompt(
      makeInput({
        context: makeContext({
          recentActivities: [
            {
              summary: makeActivitySummary(),
              analysis: "Steady aerobic ride at a comfortable effort.",
            },
            {
              summary: { ...makeActivitySummary(), id: 2, name: "Easy run" },
              analysis: "Easy shakeout, good form.",
              coachReply: "Nice work, keep this easy.",
            },
          ],
          activityComments: [
            { activityId: "1", comment: "Legs felt heavy at the start." },
          ],
        }),
      }),
    );

    expect(prompt).toContain("Recent activities (most recent first).");
    expect(prompt).toContain("Morning ride");
    expect(prompt).toContain(
      "Coach analysis: Steady aerobic ride at a comfortable effort.",
    );
    expect(prompt).toContain(
      "Athlete comment about this same activity (not an additional session): Legs felt heavy at the start.",
    );
    expect(prompt).toContain(
      "Coach reply to that comment: Nice work, keep this easy.",
    );
  });

  it("shows manual activities, the weekly note and completed reviews", () => {
    const prompt = buildCoachReplyPrompt(
      makeInput({
        context: makeContext({
          manualActivities: [
            {
              id: 3,
              startDate: "2026-10-18",
              details: "90 minutes easy spinning",
              estimatedTss: 55,
            },
          ],
          weeklyNote: "Work is busy, so keep the week light.",
          weeklyNoteWeekStartDate: "2026-10-19",
          periodReviews: [
            {
              kind: "week",
              title: "Week starting 2026-10-12",
              startDate: "2026-10-12",
              endDate: "2026-10-18",
              summary: "A steady week with one missed session.",
              comment: "I was travelling.",
              reply: "Understood.",
            },
          ],
        }),
      }),
    );

    expect(prompt).toContain("Manually recorded activities:");
    expect(prompt).toContain("90 minutes easy spinning (estimated TSS 55)");
    expect(prompt).toContain("Work is busy, so keep the week light.");
    expect(prompt).toContain("A steady week with one missed session.");
  });

  it("shows the FTP history and the profile's save date", () => {
    const prompt = buildCoachReplyPrompt(
      makeInput({
        context: makeContext({
          athleteAnswers: [
            {
              prompt: "What is your goal?",
              answer: "Run a marathon.",
              skipped: false,
              answeredAt: "2026-10-12T09:00:00Z",
            },
          ],
          athleteFtpWatts: 250,
          ftpHistory: [
            { date: "2026-10-01", value: 240, source: "user" },
            { date: "2026-10-20", value: 250, source: "coach" },
          ],
        }),
      }),
    );

    expect(prompt).toContain("Athlete profile (answers last saved 2026-10-12)");
    expect(prompt).toContain("Athlete FTP: 250 W");
    expect(prompt).toContain("FTP history");
    expect(prompt).toContain("- 2026-10-01: 240 W (user)");
  });

  it("shows the forecast stored on today's plan", () => {
    const prompt = buildCoachReplyPrompt(makeInput());

    expect(prompt).toContain(
      "Weather and daylight forecast stored with today's plan",
    );
    expect(prompt).toContain("sunrise 07:42, sunset 17:55");
  });

  it("says no activities were recorded when there are none", () => {
    const prompt = buildCoachReplyPrompt(makeInput());

    expect(prompt).toContain("No recent activities were recorded.");
  });
});
