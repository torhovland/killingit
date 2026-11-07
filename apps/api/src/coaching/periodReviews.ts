import type {
  AnalyzedActivity,
  AthleteEvent,
  CoachPlan,
  DailyHealthPoint,
} from "@killingit/shared";
import type { DietPromptContext } from "../diet/summary.js";
import { toCoachPlanActivity } from "../llm/coachPlanPrompt.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  PeriodReviewContext,
  PlanContextInput,
} from "../llm/planContext.js";
import { generatePeriodReview } from "../llm/periodReview.js";
import { PERIOD_REVIEW_PROMPT_VERSION } from "../llm/periodReviewPrompt.js";
import type { LlmProvider } from "../llm/openrouter.js";
import { addDays } from "../plans/dates.js";
import { loadPeriodReview, savePeriodReview } from "../plans/periodReviews.js";
import { applyCompletedDays } from "../plans/week.js";

export interface CapturePeriodReviewsInput {
  userId: number;
  today: string;
  timezone?: string;
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
  dailyHealth?: readonly DailyHealthPoint[];
  /** Dated goals and events the athlete stated. */
  events?: readonly AthleteEvent[];
  /** Meals and weekly nutrition summaries from the food log. */
  diet?: DietPromptContext;
  /** Cancels the review when a newer run starts. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the database-backed writer. */
  save?: typeof savePeriodReview;
  /** Injectable for tests; defaults to the database-backed reader. */
  load?: typeof loadPeriodReview;
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
  const save = input.save ?? savePeriodReview;
  const load = input.load ?? loadPeriodReview;
  const context: PlanContextInput = {
    athleteAnswers: input.athleteAnswers,
    recentActivities: input.activities.map(toCoachPlanActivity),
    today: input.today,
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    manualActivities: input.manualActivities,
    activityComments: input.activityComments,
    weeklyNote: input.weeklyNote,
    ...(input.dailyHealth !== undefined
      ? { dailyHealth: input.dailyHealth }
      : {}),
    ...(input.events !== undefined ? { events: input.events } : {}),
    ...(input.diet !== undefined ? { diet: input.diet } : {}),
  };

  const weekEnd = addDays(input.plan.week.startDate, 6);
  if (weekEnd < input.today) {
    try {
      const existing = await load(
        input.userId,
        "week",
        input.plan.week.startDate,
      );
      if (existing === null) {
        const text = await generatePeriodReview(
          input.provider,
          {
            apiKey: input.apiKey,
            model: input.model,
            ...(input.signal !== undefined ? { signal: input.signal } : {}),
          },
          {
            context,
            today: input.today,
            kind: "week",
            plan: input.plan,
            startDate: input.plan.week.startDate,
            endDate: weekEnd,
            title: `Week starting ${input.plan.week.startDate}`,
            week: applyCompletedDays(
              input.plan.week,
              input.activities,
              input.today,
              input.manualActivities,
            ),
          },
        );
        await save({
          userId: input.userId,
          kind: "week",
          startDate: input.plan.week.startDate,
          endDate: weekEnd,
          title: `Week starting ${input.plan.week.startDate}`,
          summary: text.trim(),
          model: input.model,
          promptVersion: PERIOD_REVIEW_PROMPT_VERSION,
        });
        captured.push({
          kind: "week",
          title: `Week starting ${input.plan.week.startDate}`,
          startDate: input.plan.week.startDate,
          endDate: weekEnd,
          summary: text.trim(),
          comment: null,
          reply: null,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[period-review] week summary failed: ${detail}`);
    }
  }

  if (input.plan.block.endDate < input.today) {
    try {
      const existing = await load(
        input.userId,
        "block",
        input.plan.block.startDate,
      );
      if (existing === null) {
        const text = await generatePeriodReview(
          input.provider,
          {
            apiKey: input.apiKey,
            model: input.model,
            ...(input.signal !== undefined ? { signal: input.signal } : {}),
          },
          {
            context,
            today: input.today,
            kind: "block",
            plan: input.plan,
            startDate: input.plan.block.startDate,
            endDate: input.plan.block.endDate,
            title: input.plan.block.name,
            block: input.plan.block,
          },
        );
        await save({
          userId: input.userId,
          kind: "block",
          startDate: input.plan.block.startDate,
          endDate: input.plan.block.endDate,
          title: input.plan.block.name,
          summary: text.trim(),
          model: input.model,
          promptVersion: PERIOD_REVIEW_PROMPT_VERSION,
        });
        captured.push({
          kind: "block",
          title: input.plan.block.name,
          startDate: input.plan.block.startDate,
          endDate: input.plan.block.endDate,
          summary: text.trim(),
          comment: null,
          reply: null,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[period-review] block summary failed: ${detail}`);
    }
  }
  return captured;
}
