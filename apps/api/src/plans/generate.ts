import type {
  AnalyzedActivity,
  AthleteLocation,
  BlockPlan,
  BodyMetricEstimate,
  CoachPlan,
  DailyWeather,
  MetricPoint,
  PlanGenerateMode,
  SeasonPlan,
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
  generateDailyUpdate,
  generatePlanUpdate,
  generateWeeklyUpdate,
} from "../llm/planUpdate.js";
import type { PlanUpdateRevision } from "../llm/planUpdatePrompt.js";
import { captureCompletedPeriodReviews } from "../coaching/periodReviews.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  BodyMetricHistory,
  ManualActivityContext,
  PeriodReviewContext,
  RecentActivityContext,
} from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
import { applyTrainingLoad } from "../training/load.js";
import { ftpBaselineAt, type FtpTimeline } from "../training/ftp.js";
import { addDays, startOfWeek } from "./dates.js";
import { outlineFutureSessions } from "./outline.js";
import { blockFor, promoteNextPeriod, weekFor } from "./periods.js";
import { planIsStale, planPending } from "./status.js";
import { PLAN_GENERATION_STEPS } from "./steps.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "./store.js";
import { applyCompletedDays, completionStatus, mirrorDay } from "./week.js";

export interface PlanGenerationContext {
  answers: readonly AthleteAnswerContext[];
  answersUpdatedAt: Date | null;
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  activityComments: readonly ActivityCommentContext[];
  weeklyNote: string | null;
  /** When the current week's note was last saved. */
  weeklyNoteUpdatedAt?: Date | null;
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
  /** The stored FTP time series as of today, shared by load and prompts. */
  ftpTimeline?: FtpTimeline | undefined;
  /** Stored FTP points, including future coach estimates, for the prompt. */
  ftpHistory?: readonly MetricPoint[] | undefined;
  /** Stored body weight and body-fat points, for the prompt. */
  bodyHistory?: BodyMetricHistory | undefined;
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

export interface GeneratePlanInput {
  userId: number;
  today: string;
  timezone?: string;
  /** How an explicit regeneration should treat the stored season. */
  mode?: PlanGenerateMode;
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
  /** Runs after a full build so recent activities can be reviewed against the
   * finished plan. Never runs on a day/week cascade. */
  reviewActivities?: (plan: CoachPlan) => Promise<void>;
  /** Stores the coach's FTP estimates from a generated plan, when supplied. */
  recordFtpEstimates?: (plan: CoachPlan) => Promise<void>;
  /** Stores the body-composition points the coach found, when supplied. */
  recordBodyMetrics?: (points: readonly BodyMetricEstimate[]) => Promise<void>;
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
    const mode = input.mode ?? "auto";
    // An explicit update, or answers saved after the plan, refreshes the
    // existing season instead of silently starting a new one. Without a season
    // that covers today there is nothing to refresh, so fall back to a build.
    const refreshRequested =
      mode === "updateSeason" || (mode === "auto" && stale);
    const refreshSeason =
      input.force !== true &&
      mode !== "newSeason" &&
      refreshRequested &&
      currentPlan !== null &&
      seasonCovers(currentPlan.season, today);
    // A missing plan, a deliberate fresh start, or an update with no usable
    // season builds a new season. A refresh of an existing season uses the
    // single plan-update prompt so the season, block, week and day agree.
    const needsFullPlan =
      currentPlan === null ||
      input.force === true ||
      mode === "newSeason" ||
      (refreshRequested && !refreshSeason);
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
      await generations.update(userId, PLAN_GENERATION_STEPS.review);
      await generations.update(userId, PLAN_GENERATION_STEPS.season);
      const seasonUpdate = await generateSeasonPlan(
        context.provider,
        credentials(context),
        baseContext(input),
      );
      const season: SeasonPlan = seasonUpdate.season;

      await generations.update(userId, PLAN_GENERATION_STEPS.initialBlock);
      const generatedBlock = await generateInitialBlock(
        context.provider,
        credentials(context),
        { ...baseContext(input), season },
      );
      const block: BlockPlan = generatedBlock.block;
      const foundBodyMetrics: readonly BodyMetricEstimate[] = mergeBodyMetrics(
        seasonUpdate.bodyMetrics,
        generatedBlock.bodyMetrics,
      );

      await generations.update(userId, PLAN_GENERATION_STEPS.initialWeek);
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

      await generations.update(userId, PLAN_GENERATION_STEPS.day);
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
        bodyMetrics: mergeBodyMetrics(
          foundBodyMetrics,
          weekUpdate.bodyMetrics,
          dayUpdate.bodyMetrics,
        ),
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
      const generated = withTrainingLoad(
        applyForecastToPlan(
          dropUnplacedTomorrow(
            outlineFutureSessions(completed, today),
            input.includeTomorrow === true,
          ),
          forecastForStorage(context),
        ),
        context,
      );
      assertPlanValid(generated, today, input.includeTomorrow === true);
      await generations.update(userId, PLAN_GENERATION_STEPS.save);
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
          PLAN_GENERATION_STEPS.reviewActivities,
        );
        try {
          await input.reviewActivities(saved.plan);
        } catch (err) {
          // The plan is saved; a supplementary review must not fail the build.
          console.error("[plan] activity review failed:", err);
        }
      }
      // The reviews can return an older FTP estimate for an activity date. Save
      // the plan's weekly estimates afterwards so its projection wins and is
      // not deleted by those older points.
      await persistFtpEstimates(input, generated);
      await persistBodyMetrics(input, generated);
      await generations.finish(userId);
      return saved;
    }

    if (refreshSeason && currentPlan !== null) {
      // A season refresh is an update like any other: one completion receives
      // every level and returns the revised season, block, week and day (plus
      // tomorrow and the next period when they are wanted).
      const pending = planPending(
        currentPlan,
        today,
        input.includeTomorrow,
        weatherChanged,
      );
      const plan = await advancePlan(
        input,
        currentPlan,
        pending,
        revisionNeeded,
        true,
      );
      await generations.update(userId, PLAN_GENERATION_STEPS.save);
      const saved = await plans.save(
        userId,
        plan,
        context.answersUpdatedAt,
        context.coachingInputsUpdatedAt,
        context.activitiesUpdatedAt ?? null,
      );
      if (input.reviewActivities) {
        await generations.update(
          userId,
          PLAN_GENERATION_STEPS.reviewActivities,
        );
        try {
          await input.reviewActivities(saved.plan);
        } catch (err) {
          // The plan is saved; a supplementary review must not fail the build.
          console.error("[plan] activity review failed:", err);
        }
      }
      await persistFtpEstimates(input, plan);
      await persistBodyMetrics(input, plan);
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
          withTrainingLoad(currentPlan, context),
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
    await generations.update(userId, PLAN_GENERATION_STEPS.save);
    const saved = await plans.save(
      userId,
      plan,
      context.answersUpdatedAt,
      context.coachingInputsUpdatedAt,
      context.activitiesUpdatedAt ?? null,
    );
    await persistFtpEstimates(input, plan);
    await persistBodyMetrics(input, plan);
    await generations.finish(userId);
    return saved;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    await generations.fail(userId, message);
    throw err;
  }
}

interface PlanUpdateFlags {
  season: boolean;
  block: boolean;
  week: boolean;
  day: boolean;
  tomorrow: boolean;
  nextWeek: boolean;
  nextBlock: boolean;
}

interface PlanUpdateOptions {
  expectedBlockStartDate?: string;
  nextBlockStartDate?: string;
  nextWeekStartDate?: string;
}

/**
 * Updates every level that is missing or needs revising in one completion. The
 * coach receives the stored season, block, week and day plus the next week,
 * next block and tomorrow when they exist, and returns the complete plan. The
 * API keeps the levels the request did not revise, so one prompt replaces the
 * old block → week → day cascade.
 */
async function advancePlan(
  input: GeneratePlanInput,
  current: CoachPlan,
  pending: ReturnType<typeof planPending>,
  revisionNeeded: boolean,
  seasonRefresh = false,
): Promise<CoachPlan> {
  const { today, context } = input;
  const includeTomorrow = input.includeTomorrow === true;
  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = weekFor(current, tomorrowDate);
  const blockRevision = seasonRefresh || pending.block;
  const nextBlockRevision =
    includeTomorrow && pending.nextBlock && (seasonRefresh || !blockRevision);
  const nextBlockSameWeek =
    nextBlockRevision &&
    tomorrowWeek !== null &&
    tomorrowWeek.startDate === current.week.startDate;
  const weekRevision =
    seasonRefresh ||
    blockRevision ||
    revisionNeeded ||
    pending.week ||
    nextBlockSameWeek;
  const dayRevision =
    seasonRefresh ||
    blockRevision ||
    revisionNeeded ||
    pending.week ||
    pending.day;
  const nextWeekRevision =
    includeTomorrow && startOfWeek(tomorrowDate) !== startOfWeek(today);
  const tomorrowRevision =
    includeTomorrow &&
    (pending.tomorrow ||
      weekRevision ||
      dayRevision ||
      nextBlockRevision ||
      nextWeekRevision);
  const flags: PlanUpdateFlags = {
    season: seasonRefresh,
    block: blockRevision,
    week: weekRevision,
    day: dayRevision,
    tomorrow: tomorrowRevision,
    nextWeek: nextWeekRevision,
    nextBlock: nextBlockRevision,
  };
  const options: PlanUpdateOptions = {
    ...(seasonRefresh
      ? { expectedBlockStartDate: current.block.startDate }
      : blockRevision
        ? { expectedBlockStartDate: nextBlockStartDate(current.block, today) }
        : {}),
    ...(nextBlockRevision
      ? { nextBlockStartDate: nextBlockStartDate(current.block, today) }
      : {}),
    ...(nextWeekRevision
      ? { nextWeekStartDate: startOfWeek(tomorrowDate) }
      : {}),
  };

  let plan = await requestPlanUpdate(input, current, flags, options);

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
  const finalPlan = withTrainingLoad(
    applyForecastToPlan(
      dropUnplacedTomorrow(
        outlineFutureSessions(plan, today),
        input.includeTomorrow === true,
      ),
      forecastForStorage(context),
    ),
    context,
  );
  assertPlanValid(finalPlan, today, input.includeTomorrow === true);
  if (input.includeTomorrow === true && finalPlan.tomorrow === null) {
    throw new Error(
      "The coach did not return tomorrow's session. Please regenerate the plan.",
    );
  }
  return finalPlan;
}

/** Runs the single plan-update prompt and applies only the requested levels. */
async function requestPlanUpdate(
  input: GeneratePlanInput,
  current: CoachPlan,
  flags: PlanUpdateFlags,
  options: PlanUpdateOptions,
): Promise<CoachPlan> {
  const { userId, context, generations } = input;
  const revision = { ...flags };
  await generations.update(
    userId,
    flags.season
      ? PLAN_GENERATION_STEPS.seasonRefresh
      : PLAN_GENERATION_STEPS.planUpdate,
  );
  const update = await generatePlanUpdate(
    context.provider,
    credentials(context),
    {
      ...baseContext(input),
      ...weatherContext(input),
      season: current.season,
      block: current.block,
      week: current.week,
      todayPlan: current.today,
      tomorrow: current.tomorrow,
      nextWeek: current.nextWeek,
      nextBlock: current.nextBlock,
      revision,
      ...(options.expectedBlockStartDate !== undefined
        ? { blockStartDate: options.expectedBlockStartDate }
        : {}),
      ...(options.nextBlockStartDate !== undefined
        ? { nextBlockStartDate: options.nextBlockStartDate }
        : {}),
      ...(options.nextWeekStartDate !== undefined
        ? { nextWeekStartDate: options.nextWeekStartDate }
        : {}),
    },
  );
  return applyPlanUpdate(input, current, update, revision, options);
}

/** Applies the levels the update prompt revised and keeps the rest stored. */
function applyPlanUpdate(
  input: GeneratePlanInput,
  current: CoachPlan,
  update: CoachPlan,
  revision: PlanUpdateRevision,
  options: PlanUpdateOptions,
): CoachPlan {
  const { today } = input;
  let plan: CoachPlan = { ...current };

  if (revision.season) {
    const season = withCompletedSeasonBlocks(
      update.season,
      current.season,
      today,
    );
    assertRefreshedSeason(season, update.block, today, current.block.startDate);
    plan = { ...plan, season, block: update.block };
  } else if (revision.block) {
    plan = { ...plan, season: update.season, block: update.block };
  } else if (revision.nextBlock) {
    plan = { ...plan, season: update.season };
  }

  if (
    revision.block &&
    options.expectedBlockStartDate !== undefined &&
    plan.block.startDate !== options.expectedBlockStartDate
  ) {
    throw new Error(
      `The coach returned a block with start date ${plan.block.startDate} instead of ${options.expectedBlockStartDate}. Please regenerate the plan.`,
    );
  }

  if (revision.day) {
    plan = { ...plan, week: update.week, today: update.today };
  } else if (revision.week) {
    plan = { ...plan, week: update.week, today: current.today };
  }

  if ((revision.block || revision.week) && !revision.nextBlock) {
    plan = { ...plan, nextBlock: null };
  }
  if ((revision.block || revision.week) && !revision.nextWeek) {
    plan = { ...plan, nextWeek: null };
  }
  if (revision.nextBlock) {
    plan = { ...plan, nextBlock: update.nextBlock };
  }
  if (revision.nextWeek) {
    plan = { ...plan, nextWeek: update.nextWeek };
  }

  if ((revision.block || revision.week) && !revision.tomorrow) {
    plan = { ...plan, tomorrow: null };
  }
  if (revision.tomorrow) {
    plan = { ...plan, tomorrow: update.tomorrow };
  }

  const tomorrowDate = addDays(today, 1);
  if (plan.tomorrow !== null && plan.tomorrow.date !== tomorrowDate) {
    plan = { ...plan, tomorrow: null };
  }
  if (plan.tomorrow !== null) {
    const week = weekFor(plan, plan.tomorrow.date);
    if (week === null) {
      throw new Error(
        "The coach returned tomorrow's session outside a planned week. Please regenerate the plan.",
      );
    }
    if (week.startDate === plan.week.startDate) {
      plan = { ...plan, week: mirrorDay(plan.week, plan.tomorrow) };
    } else {
      plan = { ...plan, nextWeek: mirrorDay(week, plan.tomorrow) };
    }
  }

  if (revision.week && !revision.day) {
    plan = {
      ...plan,
      week: restoreTodaysSession(plan.week, current, today),
      today: current.today,
    };
  }

  return {
    ...plan,
    bodyMetrics: mergeBodyMetrics(current.bodyMetrics, update.bodyMetrics),
  };
}

/**
 * Makes sure tomorrow is covered by a week and a block during a full build.
 * The next period is generated with the same single update prompt, so it sees
 * the current week and block as well.
 */
async function planNextPeriod(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<CoachPlan> {
  if (input.includeTomorrow !== true) {
    return plan;
  }
  const pending = planPending(plan, input.today, true);
  if (!pending.tomorrow && !pending.nextWeek && !pending.nextBlock) {
    return plan;
  }
  const tomorrowDate = addDays(input.today, 1);
  const nextBlockSameWeek =
    pending.nextBlock &&
    weekFor(plan, tomorrowDate)?.startDate === plan.week.startDate;
  return requestPlanUpdate(
    input,
    plan,
    {
      season: false,
      block: false,
      week: nextBlockSameWeek,
      day: false,
      tomorrow: true,
      nextWeek: pending.nextWeek,
      nextBlock: pending.nextBlock,
    },
    {
      ...(pending.nextBlock
        ? { nextBlockStartDate: nextBlockStartDate(plan.block, input.today) }
        : {}),
      ...(pending.nextWeek
        ? { nextWeekStartDate: startOfWeek(tomorrowDate) }
        : {}),
    },
  );
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

/** True when `today` falls inside the season's dates. */
function seasonCovers(season: SeasonPlan, today: string): boolean {
  return today >= season.startDate && today <= season.endDate;
}

/**
 * Restores the season's history after a refresh. Completed blocks are the
 * stored ones, unchanged; everything from today onward comes from the coach's
 * refreshed season. The original start date keeps the history in one season.
 */
function withCompletedSeasonBlocks(
  generated: SeasonPlan,
  previous: SeasonPlan,
  today: string,
): SeasonPlan {
  const completed = previous.blocks.filter((entry) => entry.endDate < today);
  const remaining = generated.blocks.filter((entry) => entry.endDate >= today);
  return {
    ...generated,
    startDate: previous.startDate,
    blocks: [...completed, ...remaining],
  };
}

/**
 * A refreshed season must keep the current block in place while re-planning
 * from today. Without this check the model can replace a partially completed
 * block with one that starts today, losing the block's original start date.
 */
function assertRefreshedSeason(
  season: SeasonPlan,
  block: BlockPlan,
  today: string,
  currentBlockStartDate: string,
): void {
  const remaining = season.blocks.filter((entry) => entry.endDate >= today);
  const first = remaining[0];
  if (first === undefined || first.startDate !== currentBlockStartDate) {
    throw new Error(
      "The coach returned a season refresh that moved the current block's start date. Please regenerate the plan.",
    );
  }
  for (let index = 1; index < remaining.length; index += 1) {
    const previous = remaining[index - 1];
    const current = remaining[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.startDate !== addDays(previous.endDate, 1)
    ) {
      throw new Error(
        "The coach returned a season refresh with a gap between blocks. Please regenerate the plan.",
      );
    }
  }
  const last = remaining[remaining.length - 1];
  if (last !== undefined && last.endDate !== season.endDate) {
    throw new Error(
      "The coach returned a season refresh that does not cover the rest of the season. Please regenerate the plan.",
    );
  }
  if (
    block.startDate !== currentBlockStartDate ||
    block.endDate !== first.endDate
  ) {
    throw new Error(
      "The coach returned a block refresh that does not match the remaining season. Please regenerate the plan.",
    );
  }
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

/** Stores the coach's weekly FTP estimates after a plan has been saved. */
async function persistFtpEstimates(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<void> {
  if (!input.recordFtpEstimates) {
    return;
  }
  try {
    await input.recordFtpEstimates(plan);
  } catch (err) {
    // The plan itself is saved; the time series must not fail the build.
    console.error("[plan] could not store FTP estimates:", err);
  }
}

/** Stores the body-composition points the coach found after a plan is saved. */
async function persistBodyMetrics(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<void> {
  const points = plan.bodyMetrics ?? [];
  if (!input.recordBodyMetrics || points.length === 0) {
    return;
  }
  try {
    await input.recordBodyMetrics(points);
  } catch (err) {
    // The plan itself is saved; the time series must not fail the build.
    console.error("[plan] could not store body metrics:", err);
  }
}

/**
 * Combines the body-composition points from several coach responses into one
 * point per date, oldest first. A point with neither value is dropped.
 */
function mergeBodyMetrics(
  ...sources: readonly (readonly BodyMetricEstimate[] | undefined)[]
): BodyMetricEstimate[] {
  const byDate = new Map<string, BodyMetricEstimate>();
  for (const source of sources) {
    for (const point of source ?? []) {
      if (point.weightKg === null && point.bodyFatPercent === null) {
        continue;
      }
      byDate.set(point.date, point);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The coach's daily FTP estimates for the days the stored weeks cover, from
 * today onward. Each session carries the day's projection; a session without
 * one falls back to its week's single estimate. The points are stored as coach
 * values in `athlete_metrics` so the Fitness page can chart the projection day
 * by day.
 */
export function planFtpEstimates(
  plan: CoachPlan,
): { date: string; watts: number }[] {
  const today = plan.today.date;
  const estimates = new Map<string, number>();
  const addWeek = (week: WeekPlan | null): void => {
    if (week === null) {
      return;
    }
    for (const session of week.sessions) {
      if (session.date < today) {
        continue;
      }
      const watts = session.estimatedFtpWatts ?? week.estimatedFtpWatts;
      if (watts != null && watts > 0) {
        estimates.set(session.date, watts);
      }
    }
  };
  addWeek(plan.week);
  addWeek(plan.nextWeek);
  return [...estimates]
    .map(([date, watts]) => ({ date, watts }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Attaches the resolved training stress and fitness snapshot after every
 * generation path, so stored plans always show consistent TSS/ATL/CTL/TSB.
 */
function withTrainingLoad(
  plan: CoachPlan,
  context: PlanGenerationContext,
): CoachPlan {
  return applyTrainingLoad(plan, {
    activities: context.activities,
    manualActivities: context.manualActivities,
    ftpTimeline: context.ftpTimeline,
  });
}

/**
 * The current FTP for prompts and TSS. It comes only from the stored metric
 * series: the coach read the athlete's stated FTP and the API stored it, so no
 * free text is parsed here.
 */
function ftpBaseline(context: PlanGenerationContext, today: string) {
  if (context.ftpTimeline === undefined) {
    return null;
  }
  return ftpBaselineAt(context.ftpTimeline, today);
}

function baseContext(input: GeneratePlanInput) {
  const recentActivities: RecentActivityContext[] =
    input.context.activities.map(toCoachPlanActivity);

  return {
    athleteAnswers: input.context.answers,
    recentActivities,
    athleteFtpWatts: ftpBaseline(input.context, input.today)?.watts ?? null,
    ...(input.context.ftpHistory !== undefined
      ? { ftpHistory: input.context.ftpHistory }
      : {}),
    ...(input.context.bodyHistory !== undefined
      ? { bodyHistory: input.context.bodyHistory }
      : {}),
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
