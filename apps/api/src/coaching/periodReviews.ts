import type {
  AnalyzedActivity,
  AthleteEvent,
  BlockPlan,
  CoachPlan,
  DailyHealthPoint,
  ReviewKind,
  WeekPlan,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import { errorMessage } from "../lib/errorMessage.js";
import {
  toCoachPlanActivity,
  type ActivityCommentContext,
  type ManualActivityContext,
} from "../llm/activityContext.js";
import type {
  PeriodReviewContext,
  PlanContextInput,
} from "../llm/planContext.js";
import {
  generatePeriodReview,
  type PeriodReviewCredentials,
} from "../llm/periodReview.js";
import { PERIOD_REVIEW_PROMPT_VERSION } from "../llm/periodReviewPrompt.js";
import type { LlmProvider } from "../llm/openrouter.js";
import type { AthleteAnswerContext } from "../llm/profileContext.js";
import { addDays } from "@killingit/shared";
import { loadPeriodReview, savePeriodReview } from "../plans/periodReviews.js";
import { applyCompletedDays } from "../plans/week.js";

export interface CapturePeriodReviewsInput {
  userId: number;
  today: string;
  timezone?: string | undefined;
  plan: CoachPlan;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  athleteAnswers: readonly AthleteAnswerContext[];
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  activityComments: readonly ActivityCommentContext[];
  weeklyNote: string | null;
  /** Stored daily health and recovery values for the prompt. */
  dailyHealth?: readonly DailyHealthPoint[] | undefined;
  /** Dated goals and events the athlete stated. */
  events?: readonly AthleteEvent[] | undefined;
  /** Meals and weekly nutrition summaries from the food log. */
  diet?: DietPromptContext | undefined;
  /** Cancels the review when a newer run starts. */
  signal?: AbortSignal | undefined;
  /** Injectable for tests; defaults to the database-backed writer. */
  save?: typeof savePeriodReview;
  /** Injectable for tests; defaults to the database-backed reader. */
  load?: typeof loadPeriodReview;
}

/** The detailed plan level the review prompt renders for a completed period. */
type PeriodPlanSlice = { week: WeekPlan } | { block: BlockPlan };

interface CompletedPeriod {
  kind: ReviewKind;
  startDate: string;
  endDate: string;
  title: string;
  /**
   * Built inside the guarded call so a failure while shaping the plan slice is
   * handled like the rest of the period.
   */
  planSlice: () => PeriodPlanSlice;
}

/**
 * Generates and stores one completed period's review. Returns `null` when the
 * review already exists or its generation fails, so one period never stops the
 * plan or the other period's review.
 */
async function capturePeriodReview(
  input: CapturePeriodReviewsInput,
  context: PlanContextInput,
  credentials: PeriodReviewCredentials,
  period: CompletedPeriod,
): Promise<PeriodReviewContext | null> {
  try {
    const existing = await (input.load ?? loadPeriodReview)(
      input.userId,
      period.kind,
      period.startDate,
    );
    if (existing !== null) {
      return null;
    }
    const text = await generatePeriodReview(input.provider, credentials, {
      context,
      today: input.today,
      kind: period.kind,
      plan: input.plan,
      startDate: period.startDate,
      endDate: period.endDate,
      title: period.title,
      ...period.planSlice(),
    });
    const summary = text.trim();
    await (input.save ?? savePeriodReview)({
      userId: input.userId,
      kind: period.kind,
      startDate: period.startDate,
      endDate: period.endDate,
      title: period.title,
      summary,
      model: input.model,
      promptVersion: PERIOD_REVIEW_PROMPT_VERSION,
    });
    return {
      kind: period.kind,
      title: period.title,
      startDate: period.startDate,
      endDate: period.endDate,
      summary,
      comment: null,
      reply: null,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const detail = errorMessage(err);
    console.error(`[period-review] ${period.kind} summary failed: ${detail}`);
    return null;
  }
}

/**
 * Summarises the stored plan's week and block once they have ended. The review
 * is generated before the cascade replaces them, so the completed period is not
 * lost. Failures are logged: the plan must still be generated.
 */
export async function captureCompletedPeriodReviews(
  input: CapturePeriodReviewsInput,
): Promise<PeriodReviewContext[]> {
  const captured: PeriodReviewContext[] = [];
  const context: PlanContextInput = {
    athleteAnswers: input.athleteAnswers,
    recentActivities: input.activities.map(toCoachPlanActivity),
    today: input.today,
    timezone: input.timezone,
    manualActivities: input.manualActivities,
    activityComments: input.activityComments,
    weeklyNote: input.weeklyNote,
    dailyHealth: input.dailyHealth,
    events: input.events,
    diet: input.diet,
  };
  const credentials: PeriodReviewCredentials = {
    apiKey: input.apiKey,
    model: input.model,
    signal: input.signal,
  };

  const weekEnd = addDays(input.plan.week.startDate, 6);
  if (weekEnd < input.today) {
    const review = await capturePeriodReview(input, context, credentials, {
      kind: "week",
      startDate: input.plan.week.startDate,
      endDate: weekEnd,
      title: `Week starting ${input.plan.week.startDate}`,
      planSlice: () => ({
        week: applyCompletedDays(
          input.plan.week,
          input.activities,
          input.today,
          input.timezone ?? null,
          input.manualActivities,
        ),
      }),
    });
    if (review !== null) {
      captured.push(review);
    }
  }

  if (input.plan.block.endDate < input.today) {
    const review = await capturePeriodReview(input, context, credentials, {
      kind: "block",
      startDate: input.plan.block.startDate,
      endDate: input.plan.block.endDate,
      title: input.plan.block.name,
      planSlice: () => ({ block: input.plan.block }),
    });
    if (review !== null) {
      captured.push(review);
    }
  }

  return captured;
}
