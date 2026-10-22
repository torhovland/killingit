import type {
  AnalyzedActivity,
  BlockPlan,
  CoachPlan,
  SeasonPlan,
  WeekPlan,
  DayPlan,
} from "@killingit/shared";
import { toCoachPlanActivity } from "../llm/coachPlanPrompt.js";
import {
  generateInitialBlock,
  generateSeasonPlan,
} from "../llm/planInitial.js";
import {
  generateBlockUpdate,
  generateDailyUpdate,
  generateWeeklyUpdate,
} from "../llm/planUpdate.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  RecentActivityContext,
} from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
import { addDays, startOfWeek } from "./dates.js";
import { planIsStale, planPending } from "./status.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "./store.js";
import { applyCompletedDays } from "./week.js";

export interface PlanGenerationContext {
  answers: readonly AthleteAnswerContext[];
  answersUpdatedAt: Date | null;
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  activityComments: readonly ActivityCommentContext[];
  weeklyNote: string | null;
  coachingInputsUpdatedAt: Date | null;
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

export interface GeneratePlanInput {
  userId: number;
  today: string;
  timezone?: string;
  /** Rebuild every level even when the stored plan is still current. */
  force?: boolean;
  /** The client is after 18:00, so tomorrow's session is wanted. */
  includeTomorrow?: boolean;
  /**
   * Revise the week around a new input. Today's stored session is preserved
   * unless an activity was already recorded today, in which case today's plan
   * is refreshed to describe the completed activity.
   */
  keepToday?: boolean;
  /**
   * Runs after a full build so recent activities can be reviewed against the
   * finished plan. Never runs on a day/week cascade.
   */
  reviewActivities?: (plan: CoachPlan) => Promise<void>;
  plan: StoredPlan | null;
  context: PlanGenerationContext;
  plans: PlanStore;
  generations: PlanGenerationStore;
}

/**
 * Generates or advances the athlete's plan. A missing or stale plan (or an
 * explicit force) rebuilds all four levels. Otherwise the cascade fills in a
 * missing block, then a missing week, then a missing day, revising the parent
 * level after each child.
 */
export async function runPlanGeneration(
  input: GeneratePlanInput,
): Promise<StoredPlan | null> {
  const { userId, today, context, plans, generations } = input;
  const currentPlan = input.plan?.plan ?? null;
  const stale =
    input.plan !== null &&
    planIsStale(input.plan.answersUpdatedAt, context.answersUpdatedAt);
  const needsFullPlan = currentPlan === null || stale || input.force === true;
  const inputsChanged =
    input.plan !== null &&
    context.coachingInputsUpdatedAt !== null &&
    (input.plan.coachingInputsUpdatedAt === null ||
      context.coachingInputsUpdatedAt.getTime() >
        input.plan.coachingInputsUpdatedAt.getTime());

  try {
    if (needsFullPlan) {
      await generations.update(
        userId,
        "Reviewing your profile and recent training",
        10,
      );
      await generations.update(userId, "Designing your season", 25);
      const { season } = await generateSeasonPlan(
        context.provider,
        credentials(context),
        baseContext(input),
      );

      await generations.update(userId, "Designing your first block", 45);
      const { block } = await generateInitialBlock(
        context.provider,
        credentials(context),
        { ...baseContext(input), season },
      );

      await generations.update(userId, "Building your first week", 65);
      const weekUpdate = await generateWeeklyUpdate(
        context.provider,
        credentials(context),
        {
          ...baseContext(input),
          season,
          block,
          weekStartDate: startOfWeek(today),
        },
      );

      await generations.update(userId, "Choosing today's session", 85);
      const dayUpdate = await generateDailyUpdate(
        context.provider,
        credentials(context),
        {
          ...baseContext(input),
          season,
          block: weekUpdate.block,
          week: weekUpdate.week,
        },
      );

      const generated = {
        season,
        block: weekUpdate.block,
        week: applyCompletedDays(
          dayUpdate.week,
          context.activities,
          today,
          context.manualActivities,
        ),
        today: dayUpdate.today,
        tomorrow: dayUpdate.tomorrow,
      };
      assertPlanCoversToday(generated, today);
      await generations.update(userId, "Saving your plan", 95);
      const saved = await plans.save(
        userId,
        generated,
        context.answersUpdatedAt,
        context.coachingInputsUpdatedAt,
      );
      if (input.reviewActivities) {
        await generations.update(
          userId,
          "Reviewing your recent training against your plan",
          95,
        );
        try {
          await input.reviewActivities(saved.plan);
        } catch (err) {
          // The plan is saved; a supplementary review must not fail the build.
          console.error("[plan] activity review failed:", err);
        }
      }
      await generations.finish(userId);
      return saved;
    }

    const pending = planPending(currentPlan, today, input.includeTomorrow);
    if (
      !pending.block &&
      !pending.week &&
      !pending.day &&
      !pending.tomorrow &&
      !inputsChanged
    ) {
      await generations.finish(userId);
      return input.plan;
    }

    const plan = await advancePlan(input, currentPlan, pending, inputsChanged);
    await generations.update(userId, "Saving your plan", 95);
    const saved = await plans.save(
      userId,
      plan,
      context.answersUpdatedAt,
      context.coachingInputsUpdatedAt,
    );
    await generations.finish(userId);
    return saved;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    await generations.fail(userId, message);
    throw err;
  }
}

async function advancePlan(
  input: GeneratePlanInput,
  current: CoachPlan,
  pending: ReturnType<typeof planPending>,
  inputsChanged: boolean,
): Promise<CoachPlan> {
  const { userId, today, context, generations } = input;
  let season: SeasonPlan = current.season;
  let block: BlockPlan = current.block;
  let week: WeekPlan = current.week;
  let todayPlan: DayPlan = current.today;
  let tomorrowPlan: DayPlan | null = current.tomorrow;
  let blockChanged = false;
  let weekChanged = false;

  if (pending.block) {
    await generations.update(userId, "Designing your next block", 20);
    const dayAfterBlock = addDays(block.endDate, 1);
    const update = await generateBlockUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        season,
        block,
        // If the athlete has been away, start the new block today rather than
        // backdating it into the past and immediately re-triggering the cascade.
        nextBlockStartDate: dayAfterBlock > today ? dayAfterBlock : today,
      },
    );
    season = update.season;
    block = update.block;
    blockChanged = true;
  }

  const afterBlock = {
    season,
    block,
    week,
    today: todayPlan,
    tomorrow: tomorrowPlan,
  };
  if (blockChanged || inputsChanged || planPending(afterBlock, today).week) {
    await generations.update(userId, "Building this week's plan", 45);
    const update = await generateWeeklyUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        season,
        block,
        weekStartDate: startOfWeek(today),
      },
    );
    block = update.block;
    week = update.week;
    weekChanged = true;
  }

  const afterWeek = {
    season,
    block,
    week,
    today: todayPlan,
    tomorrow: tomorrowPlan,
  };
  const afterWeekPending = planPending(afterWeek, today, input.includeTomorrow);
  if (
    blockChanged ||
    weekChanged ||
    inputsChanged ||
    afterWeekPending.day ||
    afterWeekPending.tomorrow
  ) {
    await generations.update(userId, "Choosing today's session", 70);
    const update = await generateDailyUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        season,
        block,
        week,
      },
    );
    week = update.week;
    todayPlan = update.today;
    tomorrowPlan = update.tomorrow;
  }

  if (
    input.keepToday === true &&
    current.today.date === today &&
    !hasActivityOn(context, today)
  ) {
    week = restoreTodaysSession(week, current, today);
    todayPlan = current.today;
  }

  const plan = {
    season,
    block,
    week: applyCompletedDays(
      week,
      context.activities,
      today,
      context.manualActivities,
    ),
    today: todayPlan,
    tomorrow: tomorrowPlan,
  };
  assertPlanCoversToday(plan, today);
  return plan;
}

/** True when a synced or manually recorded activity happened on `date`. */
function hasActivityOn(context: PlanGenerationContext, date: string): boolean {
  return (
    context.activities.some(
      (activity) => activity.startDate.slice(0, 10) === date,
    ) ||
    context.manualActivities.some(
      (activity) => activity.startDate.slice(0, 10) === date,
    )
  );
}

/**
 * Keeps the stored session for today while the rest of the week is revised.
 * Used when the athlete's new input describes today's session, so the coach
 * cannot propose a second workout for the same day. When an activity has
 * already been recorded today, the caller skips this so the completed session
 * can be refreshed from the latest comment instead.
 */
function restoreTodaysSession(
  week: WeekPlan,
  current: CoachPlan,
  today: string,
): WeekPlan {
  const existing = current.week.sessions.find(
    (session) => session.date === today,
  );
  if (!existing) {
    return week;
  }
  return {
    ...week,
    sessions: week.sessions.map((session) =>
      session.date === today ? existing : session,
    ),
  };
}

/**
 * Guards against a model that returns a plan for the wrong date. Without this
 * the pending check would immediately ask for another generation and loop.
 */
function assertPlanCoversToday(plan: CoachPlan, today: string): void {
  if (plan.today.date !== today) {
    throw new Error(
      "The coach returned today's session for the wrong date. Please regenerate the plan.",
    );
  }
  if (!plan.week.sessions.some((session) => session.date === today)) {
    throw new Error(
      "The coach returned a week that does not include today. Please regenerate the plan.",
    );
  }
  if (today < plan.block.startDate || today > plan.block.endDate) {
    throw new Error(
      "The coach returned a block that does not cover today. Please regenerate the plan.",
    );
  }
  if (today < plan.season.startDate || today > plan.season.endDate) {
    throw new Error(
      "The coach returned a season that does not cover today. Please regenerate the plan.",
    );
  }
  if (plan.tomorrow !== null && plan.tomorrow.date !== addDays(today, 1)) {
    throw new Error(
      "The coach returned tomorrow's session for the wrong date. Please regenerate the plan.",
    );
  }
}

function credentials(context: PlanGenerationContext) {
  return { apiKey: context.apiKey, model: context.model };
}

function baseContext(input: GeneratePlanInput) {
  const recentActivities: RecentActivityContext[] =
    input.context.activities.map(toCoachPlanActivity);

  return {
    athleteAnswers: input.context.answers,
    recentActivities,
    today: input.today,
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.context.manualActivities.length > 0
      ? { manualActivities: input.context.manualActivities }
      : {}),
    ...(input.context.activityComments.length > 0
      ? { activityComments: input.context.activityComments }
      : {}),
    ...(input.context.weeklyNote !== null
      ? { weeklyNote: input.context.weeklyNote }
      : {}),
  };
}
