import { LlmModelChoiceError, type LlmClient } from "../llm/client.js";
import { generateCoachReplies } from "../llm/coachReplyBatch.js";
import { generateCoachReply } from "../llm/coachReply.js";
import type { CoachReplyTarget } from "../llm/coachReplyPrompt.js";
import type {
  AthleteAnswerContext,
  PlanContextInput,
} from "../llm/planContext.js";
import { isLlmAbortError } from "../llm/openrouter.js";
import { GenerationSupersededError } from "../plans/generation.js";
import { loadUnansweredActivityComments } from "../plans/inputs.js";
import type { QuestionAnswerStore } from "../questions/answers.js";
import { saveCoachReply, type StoredCoachReply } from "../plans/replies.js";
import type { PlanStore } from "../plans/store.js";
import { loadReplyContext, type ReplyContextInput } from "./replyContext.js";

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
    }
  | {
      kind: "week_review" | "block_review";
      startDate: string;
      endDate: string;
      summary: string;
      comment: string;
    };

/** A one-off question the athlete asks, answered without storing anything. */
export interface CoachingQuestionRequest {
  question: string;
}

/** A one-off question's answer, with the model and time that produced it. */
export interface CoachingQuestionAnswer {
  text: string;
  model: string;
  generatedAt: Date;
}

export interface CoachReplyDependencies {
  plans: PlanStore;
  answers: QuestionAnswerStore;
  loadLlm: (userId: number) => Promise<LlmClient | null>;
  /** Injectable for tests; defaults to the stored reply context. */
  loadContext?: (input: ReplyContextInput) => Promise<PlanContextInput>;
  /** Injectable for tests; defaults to the database-backed writer. */
  saveReply?: typeof saveCoachReply;
  /** Injectable for tests; defaults to the stored unanswered comments. */
  loadUnansweredComments?: (
    userId: number,
  ) => Promise<Awaited<ReturnType<typeof loadUnansweredActivityComments>>>;
  /** True while the run asking for replies still owns the generation row. */
  isCurrent?: () => Promise<boolean>;
}

/** One reply to generate, and the prompt kind it is logged under. */
interface ReplyGeneration {
  userId: number;
  today: string;
  request: CoachReplyTarget;
  kind: "coach_reply" | "coaching_question";
  /** Log prefix, so a failure names the feature that asked for the reply. */
  label: string;
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
  const reply = await generateReply(deps, {
    userId,
    today,
    request: toPromptTarget(request),
    kind: "coach_reply",
    label: "coach-reply",
  });
  if (reply === null) {
    return null;
  }

  try {
    return await (deps.saveReply ?? saveCoachReply)({
      userId,
      kind: request.kind,
      target: replyTarget(request),
      reply: reply.text,
      model: reply.model,
    });
  } catch (err) {
    console.error("[coach-reply] could not store the reply:", err);
    return null;
  }
}

/**
 * Answers every activity comment that has no coach reply yet in one completion.
 * This is the fast phase at the start of a coach run: replies are stored before
 * the slower plan generation begins, so the athlete sees them first.
 */
export async function replyToUnansweredActivityComments(
  deps: CoachReplyDependencies,
  options: { userId: number; today: string; signal?: AbortSignal },
): Promise<StoredCoachReply[]> {
  const { userId, today, signal } = options;
  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let llm: LlmClient | null;
  let comments: Awaited<ReturnType<typeof loadUnansweredActivityComments>>;
  try {
    [plan, answers, llm, comments] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadLlm(userId),
      (deps.loadUnansweredComments ?? loadUnansweredActivityComments)(userId),
    ]);
  } catch (err) {
    if (err instanceof LlmModelChoiceError) throw err;
    console.error("[coach-reply] could not load unanswered comments:", err);
    return [];
  }

  if (plan === null || llm === null || comments.length === 0) {
    return [];
  }

  let context: PlanContextInput;
  try {
    context = await (deps.loadContext ?? loadReplyContext)({
      userId,
      today,
      athleteAnswers: answers.map(toAnswerContext),
    });
  } catch (err) {
    console.error("[coach-reply] could not load the reply context:", err);
    return [];
  }

  const activityDates = new Map(
    context.recentActivities.map((activity) => [
      String(activity.summary.id),
      activity.summary.startDate.slice(0, 10),
    ]),
  );
  const items = comments.map((entry) => ({
    id: entry.activityId,
    request: {
      kind: "activity_comment" as const,
      activityDate:
        activityDates.get(entry.activityId) ??
        entry.updatedAt?.slice(0, 10) ??
        today,
      comment: entry.comment,
    },
  }));

  let replies: Map<string, string>;
  try {
    replies = await generateCoachReplies(
      llm.provider,
      {
        apiKey: llm.apiKey,
        model: llm.model,
        ...(signal !== undefined ? { signal } : {}),
      },
      { plan: plan.plan, context, items },
    );
  } catch (err) {
    if (isLlmAbortError(err) || signal?.aborted === true) {
      throw new GenerationSupersededError();
    }
    console.error("[coach-reply] could not generate replies:", err);
    return [];
  }

  const stored: StoredCoachReply[] = [];
  for (const item of items) {
    const text = replies.get(item.id)?.trim();
    if (text === undefined || text === "") {
      continue;
    }
    if (deps.isCurrent !== undefined && !(await deps.isCurrent())) {
      throw new GenerationSupersededError();
    }
    try {
      stored.push(
        await (deps.saveReply ?? saveCoachReply)({
          userId,
          kind: "activity_comment",
          target: item.id,
          reply: text,
          model: llm.model,
        }),
      );
    } catch (err) {
      console.error("[coach-reply] could not store the reply:", err);
    }
  }
  return stored;
}

/**
 * Generates a reply to an athlete's answer to a coach clarification question.
 * Unlike `replyToCoachingInput`, the caller stores the reply with the question.
 */
export async function replyToCoachQuestion(
  deps: CoachReplyDependencies,
  options: {
    userId: number;
    today: string;
    question: string;
    answer: string;
  },
): Promise<CoachingQuestionAnswer | null> {
  const { userId, today, question, answer } = options;
  const reply = await generateReply(deps, {
    userId,
    today,
    request: { kind: "coach_question", question, answer },
    kind: "coach_reply",
    label: "coach-reply",
  });
  return reply === null
    ? null
    : { text: reply.text, model: reply.model, generatedAt: new Date() };
}

/**
 * Answers a one-off "by the way" question. Unlike `replyToCoachingInput`, this
 * persists nothing and never triggers a plan revision.
 */
export async function answerCoachingQuestion(
  deps: CoachReplyDependencies,
  options: { userId: number; today: string; question: string },
): Promise<CoachingQuestionAnswer | null> {
  const { userId, today, question } = options;
  const reply = await generateReply(deps, {
    userId,
    today,
    request: { kind: "quick_question", question },
    kind: "coaching_question",
    label: "coach-question",
  });
  return reply === null
    ? null
    : { text: reply.text, model: reply.model, generatedAt: new Date() };
}

/**
 * Loads the plan, the profile and the athlete's training context, then asks for
 * the reply text. Every reply path shares this so they all see the same context.
 */
async function generateReply(
  deps: CoachReplyDependencies,
  options: ReplyGeneration,
): Promise<{ text: string; model: string } | null> {
  const { userId, today } = options;
  let plan: Awaited<ReturnType<PlanStore["load"]>>;
  let answers: Awaited<ReturnType<QuestionAnswerStore["listForUser"]>>;
  let llm: LlmClient | null;
  try {
    [plan, answers, llm] = await Promise.all([
      deps.plans.load(userId),
      deps.answers.listForUser(userId),
      deps.loadLlm(userId),
    ]);
  } catch (err) {
    if (err instanceof LlmModelChoiceError) throw err;
    console.error(`[${options.label}] could not load the reply context:`, err);
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
        plan: plan.plan,
        context: await (deps.loadContext ?? loadReplyContext)({
          userId,
          today,
          athleteAnswers: answers.map(toAnswerContext),
        }),
        request: options.request,
      },
      options.kind,
    );
    const reply = text.trim();
    return reply === "" ? null : { text: reply, model: llm.model };
  } catch (err) {
    console.error(`[${options.label}] could not generate a reply:`, err);
    return null;
  }
}

function toAnswerContext(entry: {
  prompt: string;
  answer: string | null;
  skipped: boolean;
  answeredAt: Date | null;
}): AthleteAnswerContext {
  return {
    prompt: entry.prompt,
    answer: entry.answer,
    skipped: entry.skipped,
    answeredAt: entry.answeredAt,
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
    case "week_review":
    case "block_review":
      return request.startDate;
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
    case "week_review":
    case "block_review":
      return {
        kind: request.kind,
        startDate: request.startDate,
        endDate: request.endDate,
        summary: request.summary,
        comment: request.comment,
      };
  }
}
