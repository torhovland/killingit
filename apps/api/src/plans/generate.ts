import type {
  AnalyzedActivity,
  AthleteLocation,
  BlockPlan,
  CoachPlan,
  DailyWeather,
  WeekPlan,
  DayPlan,
} from "@killingit/shared";
import { toCoachPlanActivity } from "../llm/coachPlanPrompt.js";
import { applyForecastToPlan } from "../weather/apply.js";
import { planWeatherChanged } from "../weather/changes.js";
import type { WeatherForecastSet } from "../weather/forecast.js";
import {
  generateInitialBlock,
  generateSeasonPlan,
} from "../llm/planInitial.js";
import {
  generateBlockUpdate,
  generateDailyUpdate,
  generateTargetDayUpdate,
  generateWeeklyUpdate,
} from "../llm/planUpdate.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  ManualActivityContext,
  PeriodReviewContext,
  RecentActivityContext,
} from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
import { addDays, startOfWeek } from "./dates.js";
import { blockFor, promoteNextPeriod, weekFor } from "./periods.js";
import { planIsStale, planPending } from "./status.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "./store.js";
import { applyCompletedDays, completionStatus, mirrorDay } from "./week.js";

export interface PlanGenerationContext {
  answers: readonly AthleteAnswerContext[];
  answersUpdatedAt: Date | null;
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  activityComments: readonly ActivityCommentContext[];
  weeklyNote: string | null;
  periodReviews?: readonly PeriodReviewContext[];
  coachingInputsUpdatedAt: Date | null;
  /** Newest general coach analysis among the recent activities, if any. */
  activitiesUpdatedAt?: Date | null;
  /** The athlete's home location, used to label the forecast in prompts. */
  location?: AthleteLocation | null;
  /** The combined forecast, used by prompts and weather-change checks. */
  forecast?: readonly DailyWeather[] | null;
  /** Both provider forecasts and their combined average, stored on sessions. */
  weatherForecasts?: WeatherForecastSet | null;
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
  /** Injectable for tests; defaults to the database-backed period review writer. */
  capturePeriodReviews?: typeof captureCompletedPeriodReviews;
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
  const stored = input.plan?.plan ?? null;
  const stale =
    input.plan !== null &&
    planIsStale(input.plan.answersUpdatedAt, context.answersUpdatedAt);
  const inputsChanged =
    input.plan !== null &&
    context.coachingInputsUpdatedAt !== null &&
    (input.plan.coachingInputsUpdatedAt === null ||
      context.coachingInputsUpdatedAt.getTime() >
        input.plan.coachingInputsUpdatedAt.getTime());
  // Compare against the analyses included in the plan, not when the plan was
  // saved: an import can finish while a generation is running, so the plan may
  // be newer than its save time yet still not contain the activity.
  const activitiesChanged =
    input.plan !== null &&
    context.activitiesUpdatedAt != null &&
    (input.plan.activitiesUpdatedAt === null ||
      context.activitiesUpdatedAt.getTime() >
        input.plan.activitiesUpdatedAt.getTime());
  const revisionNeeded = inputsChanged || activitiesChanged;

  try {
    // Today may have moved into a week or block that was planned last night.
    // Promote it for this run; the raw stored plan is used below to capture the
    // ended period's review before it is dropped.
    const currentPlan =
      stored === null ? null : promoteNextPeriod(stored, today);
    const promoted = currentPlan !== null && currentPlan !== stored;
    const needsFullPlan = currentPlan === null || stale || input.force === true;
    // The forecast can move enough to make the stored week's weather advice
    // wrong even when every level is present. Treat that like any other week
    // revision so the coach can move sessions to the better days.
    const weatherChanged =
      currentPlan !== null &&
      context.forecast != null &&
      planWeatherChanged(currentPlan, context.forecast, today);

    // The cascade is about to replace the current week/block. Summarise them
    // first when they have ended, so the athlete keeps a review of the work.
    if (input.plan !== null && input.capturePeriodReviews) {
      await input.capturePeriodReviews({
        userId,
        today,
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        plan: input.plan.plan,
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        athleteAnswers: context.answers,
        activities: context.activities,
        manualActivities: context.manualActivities,
        activityComments: context.activityComments,
        weeklyNote: context.weeklyNote,
      });
    }

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

      await generations.update(userId, "Designing your block", 45);
      const { block } = await generateInitialBlock(
        context.provider,
        credentials(context),
        { ...baseContext(input), season },
      );

      await generations.update(userId, "Building your week", 65);
      const weekUpdate = await generateWeeklyUpdate(
        context.provider,
        credentials(context),
        {
          ...baseContext(input),
          ...weatherContext(input),
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
          ...weatherContext(input),
          season,
          block: weekUpdate.block,
          week: weekUpdate.week,
        },
      );

      const todayPlan = deriveTodayStatus(
        context,
        today,
        dayUpdate.today,
        dayUpdate.today,
      );
      const draft: CoachPlan = {
        season,
        block: weekUpdate.block,
        week: dayUpdate.week,
        today: todayPlan,
        tomorrow: dayUpdate.tomorrow,
        nextWeek: null,
        nextBlock: null,
      };
      const withNextPeriod =
        input.includeTomorrow === true
          ? await planNextPeriod(input, draft)
          : draft;
      const completed: CoachPlan = {
        ...withNextPeriod,
        week: applyCompletedDays(
          withNextPeriod.week,
          context.activities,
          today,
          context.manualActivities,
          withNextPeriod.today,
        ),
      };
      const generated = applyForecastToPlan(
        dropUnplacedTomorrow(completed, input.includeTomorrow === true),
        forecastForStorage(context),
      );
      assertPlanValid(generated, today, input.includeTomorrow === true);
      await generations.update(userId, "Saving your plan", 95);
      const saved = await plans.save(
        userId,
        generated,
        context.answersUpdatedAt,
        context.coachingInputsUpdatedAt,
        context.activitiesUpdatedAt ?? null,
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

    const pending = planPending(
      currentPlan,
      today,
      input.includeTomorrow,
      weatherChanged,
    );
    if (
      !pending.block &&
      !pending.week &&
      !pending.day &&
      !pending.tomorrow &&
      !pending.nextWeek &&
      !pending.nextBlock &&
      !revisionNeeded
    ) {
      if (promoted && input.plan !== null) {
        // Persist the promotion and keep the timestamps that describe what the
        // current plan actually includes.
        const saved = await plans.save(
          userId,
          currentPlan,
          input.plan.answersUpdatedAt,
          input.plan.coachingInputsUpdatedAt,
          input.plan.activitiesUpdatedAt,
        );
        await generations.finish(userId);
        return saved;
      }
      await generations.finish(userId);
      return input.plan;
    }

    const plan = await advancePlan(input, currentPlan, pending, revisionNeeded);
    await generations.update(userId, "Saving your plan", 95);
    const saved = await plans.save(
      userId,
      plan,
      context.answersUpdatedAt,
      context.coachingInputsUpdatedAt,
      context.activitiesUpdatedAt ?? null,
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
  revisionNeeded: boolean,
): Promise<CoachPlan> {
  const { userId, today, context, generations } = input;
  let plan: CoachPlan = { ...current };
  let blockChanged = false;
  let weekChanged = false;

  if (pending.block) {
    await generations.update(userId, "Designing your next block", 20);
    const update = await generateBlockUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        season: plan.season,
        block: plan.block,
        // If the athlete has been away, start the new block today rather than
        // backdating it into the past and immediately re-triggering the cascade.
        nextBlockStartDate: nextBlockStartDate(plan.block, today),
      },
    );
    plan = {
      ...plan,
      season: update.season,
      block: update.block,
      nextBlock: null,
      nextWeek: null,
      tomorrow: null,
    };
    blockChanged = true;
  }

  if (blockChanged || revisionNeeded || pending.week) {
    await generations.update(userId, "Building this week's plan", 45);
    const update = await generateWeeklyUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        ...weatherContext(input),
        season: plan.season,
        block: plan.block,
        weekStartDate: startOfWeek(today),
      },
    );
    plan = {
      ...plan,
      block: update.block,
      week: update.week,
      nextWeek: null,
      nextBlock: null,
      tomorrow: null,
    };
    weekChanged = true;
  }

  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = weekFor(plan, tomorrowDate);
  const tomorrowInCurrentWeek = tomorrowWeek?.startDate === plan.week.startDate;
  const afterCurrent = planPending(plan, today, input.includeTomorrow);
  if (
    blockChanged ||
    weekChanged ||
    revisionNeeded ||
    afterCurrent.day ||
    (input.includeTomorrow === true &&
      tomorrowInCurrentWeek &&
      afterCurrent.tomorrow)
  ) {
    await generations.update(userId, "Choosing today's session", 70);
    const update = await generateDailyUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        ...weatherContext(input),
        season: plan.season,
        block: plan.block,
        week: plan.week,
      },
    );
    plan = {
      ...plan,
      week: update.week,
      today: update.today,
      tomorrow: update.tomorrow,
    };
  }

  if (
    input.keepToday === true &&
    current.today.date === today &&
    !hasActivityOn(context, today)
  ) {
    plan = {
      ...plan,
      week: restoreTodaysSession(plan.week, current, today),
      today: current.today,
    };
  }

  plan = {
    ...plan,
    today: deriveTodayStatus(
      context,
      today,
      plan.today,
      current.today.date === today ? current.today : plan.today,
    ),
  };

  if (input.includeTomorrow === true) {
    plan = await planNextPeriod(input, plan);
  }

  plan = {
    ...plan,
    week: applyCompletedDays(
      plan.week,
      context.activities,
      today,
      context.manualActivities,
      plan.today,
    ),
  };
  const finalPlan = applyForecastToPlan(
    dropUnplacedTomorrow(plan, input.includeTomorrow === true),
    forecastForStorage(context),
  );
  assertPlanValid(finalPlan, today, input.includeTomorrow === true);
  return finalPlan;
}

/**
 * Makes sure tomorrow is covered by a week and a block, generating the next
 * week and/or block when tomorrow has crossed into them. The current week and
 * block are left alone when tomorrow belongs to a later one. Tomorrow's day
 * plan is generated against the target week and mirrored into it, so the Day
 * tab and the Week tab always agree.
 */
async function planNextPeriod(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<CoachPlan> {
  const { userId, today, context, generations } = input;
  const tomorrowDate = addDays(today, 1);
  let next = plan;
  let targetBlock = blockFor(plan, tomorrowDate);
  let targetWeek = weekFor(plan, tomorrowDate);
  let regenerated = false;

  // A week that covers tomorrow but does not start on its Monday is stale.
  if (
    targetWeek !== null &&
    targetWeek.startDate !== startOfWeek(tomorrowDate)
  ) {
    if (next.nextWeek?.startDate === targetWeek.startDate) {
      next = { ...next, nextWeek: null };
    }
    targetWeek = null;
  }

  if (targetBlock === null) {
    await generations.update(userId, "Designing your next block", 55);
    const update = await generateBlockUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        season: next.season,
        block: next.block,
        nextBlockStartDate: nextBlockStartDate(next.block, today),
      },
    );
    next = {
      ...next,
      season: update.season,
      nextBlock: update.block,
      // Any next week was planned under the old block.
      nextWeek: null,
      tomorrow: null,
    };
    targetBlock = update.block;
    targetWeek = null;
    regenerated = true;
  }

  if (targetWeek === null) {
    const weekStartDate = startOfWeek(tomorrowDate);
    await generations.update(
      userId,
      "Building next week's plan",
      regenerated ? 75 : 45,
    );
    const update = await generateWeeklyUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        ...weatherContext(input),
        season: next.season,
        block: targetBlock,
        weekStartDate,
      },
    );
    if (update.week.startDate !== weekStartDate) {
      throw new Error(
        "The coach returned next week's plan for the wrong week. Please regenerate the plan.",
      );
    }
    const sameBlock = targetBlock === next.nextBlock;
    const startsNextWeek = update.week.startDate !== next.week.startDate;
    next = sameBlock
      ? { ...next, nextBlock: update.block }
      : { ...next, block: update.block };
    next = startsNextWeek
      ? { ...next, nextWeek: update.week }
      : { ...next, week: update.week };
    targetBlock = sameBlock ? update.block : next.block;
    targetWeek = update.week;
    regenerated = true;
  }

  const hasTargetSession = targetWeek.sessions.some(
    (session) => session.date === tomorrowDate,
  );
  if (
    regenerated ||
    next.tomorrow?.date !== tomorrowDate ||
    !hasTargetSession
  ) {
    await generations.update(userId, "Choosing tomorrow's session", 90);
    const update = await generateTargetDayUpdate(
      context.provider,
      credentials(context),
      {
        ...baseContext(input),
        today: tomorrowDate,
        ...weatherContext(input),
        season: next.season,
        block: targetBlock,
        week: targetWeek,
      },
    );
    if (update.today.date !== tomorrowDate) {
      throw new Error(
        "The coach returned tomorrow's session for the wrong date. Please regenerate the plan.",
      );
    }
    if (update.week.startDate !== targetWeek.startDate) {
      throw new Error(
        "The coach returned a week that does not match tomorrow's week. Please regenerate the plan.",
      );
    }
    const day = update.today;
    next =
      targetWeek.startDate === next.week.startDate
        ? { ...next, week: mirrorDay(update.week, day), tomorrow: day }
        : { ...next, nextWeek: mirrorDay(update.week, day), tomorrow: day };
  }

  return next;
}

/** The day after the current block, or today if the block already ended. */
function nextBlockStartDate(block: BlockPlan, today: string): string {
  const dayAfterBlock = addDays(block.endDate, 1);
  return dayAfterBlock > today ? dayAfterBlock : today;
}

/** True when a synced or manually recorded activity happened on `date`. */
function hasActivityOn(context: PlanGenerationContext, date: string): boolean {
  return activityOn(context, date) !== null;
}

interface CompletionActivity {
  type: string;
  elapsedTime: number;
}

/** The first synced or manually recorded activity on `date`, if any. */
function activityOn(
  context: PlanGenerationContext,
  date: string,
): CompletionActivity | null {
  const synced = context.activities.find(
    (activity) => activity.startDate.slice(0, 10) === date,
  );
  if (synced) {
    return { type: synced.type, elapsedTime: synced.elapsedTime };
  }
  const manual = context.manualActivities.find(
    (activity) => activity.startDate.slice(0, 10) === date,
  );
  return manual ? { type: "manual", elapsedTime: 0 } : null;
}

/**
 * Settles today's status from what was recorded. The coach's `partial` verdict
 * is kept because it can see the activity's analysis and comments; when it only
 * returns `planned`, compare the activity with the planned duration (with
 * slack). Without an activity, today cannot be completed.
 */
function deriveTodayStatus(
  context: PlanGenerationContext,
  today: string,
  plan: DayPlan,
  planned: DayPlan,
): DayPlan {
  if (plan.date !== today) {
    return plan;
  }
  const activity = activityOn(context, today);
  if (!activity) {
    return {
      ...plan,
      status: plan.type === "rest" ? "rest" : "planned",
    };
  }
  if (plan.status === "completed" || plan.status === "partial") {
    return plan;
  }
  return { ...plan, status: completionStatus(planned, activity) };
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
 * A tomorrow session that falls outside both stored weeks and blocks cannot be
 * shown next to a week plan. This happens when a server-triggered revision runs
 * without `includeTomorrow` (for example a comment saved after 18:00); keep the
 * plan valid and let the next visit that asks for tomorrow regenerate it.
 */
function dropUnplacedTomorrow(
  plan: CoachPlan,
  includeTomorrow: boolean,
): CoachPlan {
  if (includeTomorrow || plan.tomorrow === null) {
    return plan;
  }
  const date = plan.tomorrow.date;
  if (weekFor(plan, date) !== null && blockFor(plan, date) !== null) {
    return plan;
  }
  return { ...plan, tomorrow: null };
}

/**
 * Guards against a model that returns a plan for the wrong date. Without this
 * the pending check would immediately ask for another generation and loop.
 */
function assertPlanValid(
  plan: CoachPlan,
  today: string,
  includeTomorrow: boolean,
): void {
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
  if (plan.nextWeek !== null) {
    if (plan.nextWeek.startDate !== startOfWeek(plan.nextWeek.startDate)) {
      throw new Error(
        "The coach returned a week that does not start on a Monday. Please regenerate the plan.",
      );
    }
    if (plan.nextWeek.sessions[0]?.date !== plan.nextWeek.startDate) {
      throw new Error(
        "The coach returned a week whose sessions do not match its start date. Please regenerate the plan.",
      );
    }
    if (plan.nextWeek.startDate <= plan.week.startDate) {
      throw new Error(
        "The coach returned a next week that is not after the current week. Please regenerate the plan.",
      );
    }
    if (
      includeTomorrow &&
      plan.nextWeek.startDate !== startOfWeek(addDays(today, 1))
    ) {
      throw new Error(
        "The coach returned the wrong next week. Please regenerate the plan.",
      );
    }
  }
  if (plan.nextBlock !== null) {
    if (plan.nextBlock.startDate <= plan.block.endDate) {
      throw new Error(
        "The coach returned a next block that does not follow the current block. Please regenerate the plan.",
      );
    }
    if (plan.nextBlock.startDate > plan.nextBlock.endDate) {
      throw new Error(
        "The coach returned a next block with invalid dates. Please regenerate the plan.",
      );
    }
  }
  if (plan.tomorrow !== null) {
    const tomorrowDate = addDays(today, 1);
    if (plan.tomorrow.date !== tomorrowDate) {
      throw new Error(
        "The coach returned tomorrow's session for the wrong date. Please regenerate the plan.",
      );
    }
    const week = weekFor(plan, tomorrowDate);
    if (
      week === null ||
      !week.sessions.some((session) => session.date === tomorrowDate)
    ) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned week. Please regenerate the plan.",
      );
    }
    if (blockFor(plan, tomorrowDate) === null) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned block. Please regenerate the plan.",
      );
    }
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
    ...(input.context.periodReviews !== undefined &&
    input.context.periodReviews.length > 0
      ? { periodReviews: input.context.periodReviews }
      : {}),
  };
}

/**
 * The full provider set is stored on sessions for display. Older tests and
 * callers may supply only the combined forecast, so use that as a fallback.
 */
function forecastForStorage(
  context: PlanGenerationContext,
): WeatherForecastSet | null {
  if (context.weatherForecasts) {
    return context.weatherForecasts;
  }
  if (!context.forecast || context.forecast.length === 0) {
    return null;
  }
  return {
    openMeteo: [],
    yr: [],
    combined: [...context.forecast],
  };
}

/**
 * Weather is only relevant to the week and day prompts, so it is added to
 * those prompts rather than to the season and block prompts.
 */
function weatherContext(input: GeneratePlanInput) {
  const forecast = input.context.forecast;
  if (!forecast || forecast.length === 0) {
    return {};
  }
  const name = input.context.location?.name;
  return {
    forecast,
    ...(name !== undefined && name !== null ? { locationName: name } : {}),
  };
}
