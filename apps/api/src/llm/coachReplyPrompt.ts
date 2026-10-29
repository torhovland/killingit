import type { CoachPlan } from "@killingit/shared";
import type { AthleteAnswerContext } from "./planContext.js";
import {
  formatAthleteProfile,
  formatDayPlan,
  formatPlanLevels,
  formatPlannedSession,
} from "./planContext.js";
import {
  GLOBAL_PROMPT_RULES,
  PLAIN_TEXT_RULES,
  promptSections,
} from "./promptRules.js";

/** The athlete input the coach is replying to. */
export type CoachReplyTarget =
  | {
      kind: "activity_comment";
      activityDate: string;
      comment: string;
    }
  | { kind: "weekly_note"; weekStartDate: string; note: string }
  | { kind: "manual_activity"; startDate: string; details: string }
  | {
      kind: "week_review" | "block_review";
      startDate: string;
      endDate: string;
      summary: string;
      comment: string;
    }
  | { kind: "quick_question"; question: string }
  | { kind: "coach_question"; question: string; answer: string };

export interface CoachReplyPromptInput {
  today: string;
  plan: CoachPlan;
  athleteAnswers: readonly AthleteAnswerContext[];
  request: CoachReplyTarget;
}

const COACH_REPLY_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "The athlete has just shared something about their training: a comment on a workout, a completed week or block, a note for the week, or a manual activity.",
  "Reply briefly in 1-2 sentences of plain text. Acknowledge the input in your own words, explain how it affects the plan, and state what you will adjust. Be specific to the athlete's goal and current block. Do not restate the whole plan or ask questions.",
  PLAIN_TEXT_RULES,
);

const QUICK_QUESTION_SYSTEM_PROMPT = promptSections(
  GLOBAL_PROMPT_RULES,
  "The athlete is asking a one-off question about their training.",
  "Answer it directly and briefly in 1-3 sentences of plain text, using their goal, current plan, and athlete profile. This is a conversation only: it does not change the training plan and nothing from it is stored. Do not ask follow-up questions.",
  PLAIN_TEXT_RULES,
);

/** Builds the chat messages for a short reply to an athlete input. */
export function buildCoachReplyMessages(input: CoachReplyPromptInput): {
  role: "system" | "user";
  content: string;
}[] {
  return [
    {
      role: "system",
      content:
        input.request.kind === "quick_question"
          ? QUICK_QUESTION_SYSTEM_PROMPT
          : COACH_REPLY_SYSTEM_PROMPT,
    },
    { role: "user", content: buildCoachReplyPrompt(input) },
  ];
}

/** Exposed for tests and for inspecting exactly what is sent to the model. */
export function buildCoachReplyPrompt(input: CoachReplyPromptInput): string {
  const { plan, request } = input;
  const targetDate =
    request.kind === "weekly_note" ||
    request.kind === "quick_question" ||
    request.kind === "coach_question" ||
    request.kind === "week_review" ||
    request.kind === "block_review"
      ? null
      : requestDate(request);
  const targetSession =
    targetDate === null
      ? null
      : plan.week.sessions.find((session) => session.date === targetDate);

  const lines = [
    `Today's date: ${input.today}`,
    "",
    ...formatAthleteProfile(input.athleteAnswers),
    "",
    ...formatPlanLevels(plan),
    "",
    "Today's session:",
    formatDayPlan(plan.today),
  ];

  if (plan.tomorrow !== null) {
    lines.push("", "Tomorrow's session:", formatDayPlan(plan.tomorrow));
  }
  if (targetSession) {
    lines.push(
      "",
      `Planned session on ${targetDate}: ${formatPlannedSession(targetSession)}`,
    );
  }
  if (request.kind === "week_review" || request.kind === "block_review") {
    lines.push(
      "",
      `Coach summary of the completed ${request.kind === "week_review" ? "week" : "block"} (${request.startDate} → ${request.endDate}):`,
      request.summary.trim(),
    );
  }

  lines.push("", "The athlete just shared:", formatRequest(request));

  if (request.kind === "quick_question") {
    lines.push(
      "This question is a one-off conversation. It is not stored and does not change the plan, so answer it without proposing a plan revision.",
    );
  } else if (request.kind !== "weekly_note" && targetDate === input.today) {
    lines.push(
      "Today's session has already happened or is being reported, so it will not be changed. The rest of the week and tomorrow will be revised.",
    );
  } else {
    lines.push(
      "The week and tomorrow will be revised around this input if it changes the plan.",
    );
  }

  lines.push("", "Write your brief reply to the athlete.");
  return lines.join("\n");
}

function requestDate(request: CoachReplyTarget): string {
  if (
    request.kind === "weekly_note" ||
    request.kind === "quick_question" ||
    request.kind === "coach_question"
  ) {
    return "";
  }
  return request.kind === "activity_comment"
    ? request.activityDate
    : request.startDate;
}

function formatRequest(request: CoachReplyTarget): string {
  switch (request.kind) {
    case "activity_comment":
      return `Comment on the activity on ${request.activityDate}: "${request.comment.trim()}"`;
    case "weekly_note":
      return `Weekly note for the week starting ${request.weekStartDate}: "${request.note.trim()}"`;
    case "manual_activity":
      return `Manual activity on ${request.startDate}: "${request.details.trim()}"`;
    case "week_review":
    case "block_review":
      return `Comment on the completed ${request.kind === "week_review" ? "week" : "block"} (${request.startDate} → ${request.endDate}): "${request.comment.trim()}"`;
    case "quick_question":
      return `Question: "${request.question.trim()}"`;
    case "coach_question":
      return `Your clarification question: "${request.question.trim()}"\nAthlete answer: "${request.answer.trim()}"`;
  }
}
