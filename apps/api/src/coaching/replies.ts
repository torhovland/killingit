import type { LlmClient } from "../llm/client.js";
import { generateCoachReply } from "../llm/coachReply.js";
import type { CoachReplyTarget } from "../llm/coachReplyPrompt.js";
import type { AthleteAnswerContext } from "../llm/planContext.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import { saveCoachReply, type StoredCoachReply } from "../plans/replies.js";
import type { PlanStore } from "../plans/store.js";

/** The athlete input the coach is replying to. */
export type CoachingReplyRequest =
  | {
      kind: "activity_comment";
      activityId: string;
      activityDate: string;
      comment: string;
    }
  | { kind: "weekly_note"; weekStartDate: string; note: string }
  | {
      kind: "manual_activity";
      manualActivityId: number;
      startDate: string;
      details: string;
    };

/** A one-off question the athlete asks, answered without storing anything. */
export interface CoachingQuestionRequest {
  question: string;
}

export interface CoachReplyDependencies {
  plans: PlanStore;
  answers: QuestionAnswerStore;
  loadLlm: () => Promise<LlmClient | null>;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveReply?: typeof saveCoachReply;
}

/**
 * Generates and stores a short coach reply to an athlete input. Returns null
 * when there is no stored plan or no LLM configured, and swallows generation
 * failures: the athlete's input must be saved even if the coach cannot answer.
 */
export async function replyToCoachingInput(
  deps: CoachReplyDependencies,
  options: { userId: number; today: string; request: CoachingReplyRequest },
): Promise<StoredCoachReply | null> {
  const { userId, today, request } = options;

  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let llm: LlmClient | null;
  try {
    [plan, answers, llm] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadLlm(),
    ]);
  } catch (err) {
    console.error("[coach-reply] could not load the reply context:", err);
    return null;
  }

  if (plan === null || llm === null) {
    return null;
  }

  try {
    const text = await generateCoachReply(
      llm.provider,
      { apiKey: llm.apiKey, model: llm.model },
      {
        today,
        plan: plan.plan,
        athleteAnswers: answers.map(toAnswerContext),
        request: toPromptTarget(request),
      },
    );
    const reply = text.trim();
    if (reply === "") {
      return null;
    }
    return await (deps.saveReply ?? saveCoachReply)({
      userId,
      kind: request.kind,
      target: replyTarget(request),
      reply,
      model: llm.model,
    });
  } catch (err) {
    console.error("[coach-reply] could not generate a reply:", err);
    return null;
  }
}

/**
 * Answers a one-off "by the way" question. Unlike `replyToCoachingInput`, this
 * persists nothing and never triggers a plan revision.
 */
export interface CoachingQuestionAnswer {
  text: string;
  model: string;
  generatedAt: Date;
}

export async function answerCoachingQuestion(
  deps: CoachReplyDependencies,
  options: { userId: number; today: string; question: string },
): Promise<CoachingQuestionAnswer | null> {
  const { userId, today, question } = options;

  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let llm: LlmClient | null;
  try {
    [plan, answers, llm] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadLlm(),
    ]);
  } catch (err) {
    console.error("[coach-question] could not load the reply context:", err);
    return null;
  }

  if (plan === null || llm === null) {
    return null;
  }

  try {
    const text = await generateCoachReply(
      llm.provider,
      { apiKey: llm.apiKey, model: llm.model },
      {
        today,
        plan: plan.plan,
        athleteAnswers: answers.map(toAnswerContext),
        request: { kind: "quick_question", question },
      },
    );
    const reply = text.trim();
    if (reply === "") {
      return null;
    }
    return {
      text: reply,
      model: llm.model,
      generatedAt: new Date(),
    };
  } catch (err) {
    console.error("[coach-question] could not generate a reply:", err);
    return null;
  }
}

function toAnswerContext(entry: {
  prompt: string;
  answer: string | null;
  skipped: boolean;
}): AthleteAnswerContext {
  return {
    prompt: entry.prompt,
    answer: entry.answer,
    skipped: entry.skipped,
  };
}

function replyTarget(request: CoachingReplyRequest): string {
  switch (request.kind) {
    case "activity_comment":
      return request.activityId;
    case "weekly_note":
      return request.weekStartDate;
    case "manual_activity":
      return String(request.manualActivityId);
  }
}

function toPromptTarget(request: CoachingReplyRequest): CoachReplyTarget {
  switch (request.kind) {
    case "activity_comment":
      return {
        kind: request.kind,
        activityDate: request.activityDate,
        comment: request.comment,
      };
    case "weekly_note":
      return {
        kind: request.kind,
        weekStartDate: request.weekStartDate,
        note: request.note,
      };
    case "manual_activity":
      return {
        kind: request.kind,
        startDate: request.startDate,
        details: request.details,
      };
  }
}
