import type {
  AnalyzedActivity,
  AthleteEvent,
  AthleteLocation,
  BlockPlan,
  BodyMetricEstimate,
  CoachPlan,
  DailyHealthPoint,
  DailyWeather,
  DietPlan,
  MetricPoint,
  PlanGenerateMode,
  SeasonPlan,
  ThresholdSummary,
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
import type { DietPromptContext } from "../diet/summary.js";
import type {
  ActivityCommentContext,
  AthleteAnswerContext,
  BodyMetricHistory,
  CoachingSurveyAdjustmentContext,
  CalorieTargetPoint,
  ManualActivityContext,
  PeriodReviewContext,
  RecentActivityContext,
} from "../llm/planContext.js";
import type { LlmProvider } from "../llm/openrouter.js";
import { applyTrainingLoad, currentTrainingLoad } from "../training/load.js";
import {
  ftpBaselineAt,
  ftpTimeline,
  type ThresholdTimeline,
} from "../training/thresholds.js";
import { addDays, startOfWeek } from "@killingit/shared";
import {
  dietProgressPending,
  mergeDietProgressTargets,
  syncDietProgressTargets,
} from "./dietProgress.js";
import {
  GenerationSupersededError,
  isGenerationSuperseded,
} from "./generation.js";
import type { CoachQuestionSourceKind } from "./coachQuestions.js";
import { outlineWeekPlans } from "./outline.js";
import { blockFor, promoteNextPeriod, weekFor } from "./periods.js";
import { planIsStale, planPending } from "./status.js";
import { PLAN_GENERATION_STEPS } from "./steps.js";
import { calorieEstimateProblems } from "./calorieEstimates.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "./store.js";
import { applyCompletedDays, completionStatus } from "./week.js";

export interface PlanGenerationContext {
  answers: readonly AthleteAnswerContext[];
  answersUpdatedAt: Date | null;
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  activityComments: readonly ActivityCommentContext[];
  weeklyNote: string | null;
  /** The Monday of the week the current note belongs to. */
  weeklyNoteWeekStartDate?: string | null;
  /** The coach's reply to the current week's note, when one exists. */
  weeklyNoteReply?: string | null;
  /** When the current week's note was last saved. */
  weeklyNoteUpdatedAt?: Date | null;
  periodReviews?: readonly PeriodReviewContext[];
  /** When the newest week review was generated or its comment answered. */
  weekReviewUpdatedAt?: Date | null;
  /** When the newest block review was generated or its comment answered. */
  blockReviewUpdatedAt?: Date | null;
  coachingInputsUpdatedAt: Date | null;
  /** Survey answers changed after the stored plan was generated. */
  coachingSurveyAdjustments?: readonly CoachingSurveyAdjustmentContext[];
  /** Newest general coach analysis among the recent activities, if any. */
  activitiesUpdatedAt?: Date | null;
  /** The athlete's home location, used to label the forecast in prompts. */
  location?: AthleteLocation | null;
  /** The combined forecast, used by prompts and weather-change checks. */
  forecast?: readonly DailyWeather[] | null;
  /** Both provider forecasts and their combined average, stored on sessions. */
  weatherForecasts?: WeatherForecastSet | null;
  /** Stored FTP history for the prompt, oldest first. */
  ftpHistory?: readonly MetricPoint[] | undefined;
  /** Every threshold measure in effect today, across all sports. */
  thresholds?: readonly ThresholdSummary[] | undefined;
  /** One threshold timeline per sport and measure, for sport-aware TSS. */
  thresholdTimelines?: readonly ThresholdTimeline[] | undefined;
  /** Stored body weight and body-fat points, for the prompt. */
  bodyHistory?: BodyMetricHistory | undefined;
  /** Stored daily sleep, HRV, readiness and related values for the prompt. */
  dailyHealth?: readonly DailyHealthPoint[] | undefined;
  /** The coach's current diet goal and weight-trend assessment. */
  dietGoal?: DietPlan | null;
  /** Whether the athlete has enabled diet advice. */
  dietAdvice?: boolean;
  /** The coach's earlier calorie targets for recent days, newest first. */
  calorieHistory?: readonly CalorieTargetPoint[] | undefined;
  /** Dated goals and events the athlete stated, for every plan prompt. */
  events?: readonly AthleteEvent[] | undefined;
  /** Meals from the last seven days and completed-week summaries. */
  diet?: DietPromptContext | undefined;
  provider: LlmProvider;
  apiKey: string;
  /** Daily model, kept as the default for older callers and tests. */
  model: string;
  /** Season/block model; falls back to `model`. */
  seasonModel?: string;
  /** Week/day model; falls back to `model`. */
  dailyModel?: string;
  /** Cancels this run's provider requests when a newer run starts. */
  signal?: AbortSignal;
}

export interface GeneratePlanInput {
  userId: number;
  /** The run that must still own the generation row before anything is saved. */
  runId: string;
  /** Cancels the run's provider requests when a newer run starts. */
  signal?: AbortSignal;
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
   * is refreshed to add a short completion note to the planned workout.
   */
  keepToday?: boolean;
  /** Stores the coach's FTP estimates from a generated plan, when supplied. */
  recordFtpEstimates?: (plan: CoachPlan) => Promise<void>;
  /** Stores the body-composition points the coach found, when supplied. */
  recordBodyMetrics?: (points: readonly BodyMetricEstimate[]) => Promise<void>;
  /** Stores the clarification question the coach asked, when supplied. */
  recordCoachQuestion?: (input: {
    question: string;
    model: string;
    sourceKind: CoachQuestionSourceKind;
  }) => Promise<void>;
  /** Clears unanswered questions before a new season or season refresh. */
  clearCoachQuestions?: () => Promise<void>;
  /** Clears consumed survey adjustments after a successful season refresh. */
  clearCoachingSurveyAdjustments?: () => Promise<void>;
  /** Injectable for tests; defaults to the database-backed period review writer. */
  capturePeriodReviews?: (
    input: Parameters<typeof captureCompletedPeriodReviews>[0],
  ) => Promise<readonly PeriodReviewContext[] | void>;
  /** Marks prompt-log rows from a generation that ended in failure. */
  markPromptsFailed?: (
    userId: number,
    since: Date,
    error: string,
  ) => Promise<void>;
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
  const { userId, today, plans, generations, runId } = input;
  let context = input.context;
  const stored = input.plan?.plan ?? null;
  const stale =
    input.plan !== null &&
    planIsStale(input.plan.answersUpdatedAt, context.answersUpdatedAt);
  const ensureCurrent = async (): Promise<void> => {
    if (input.signal?.aborted === true) {
      throw new GenerationSupersededError();
    }
    if (!(await generations.isCurrent(userId, runId))) {
      throw new GenerationSupersededError();
    }
  };

  try {
    await ensureCurrent();
    // Today may have moved into a week or block that was planned last night.
    // Promote it for this run; the raw stored plan is used below to capture the
    // ended period's review before it is dropped.
    const currentPlan =
      stored === null ? null : promoteNextPeriod(stored, today);
    const promoted = currentPlan !== null && currentPlan !== stored;
    const mode = input.mode ?? "auto";

    // The cascade is about to replace the current week/block. Summarise them
    // first when they have ended, so the athlete keeps a review of the work.
    // The new review is added to this run's context, so the block update can
    // use it immediately and the block becomes pending in the same visit.
    if (input.plan !== null && input.capturePeriodReviews) {
      const captured = await input.capturePeriodReviews({
        userId,
        today,
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        plan: input.plan.plan,
        provider: context.provider,
        apiKey: context.apiKey,
        model: seasonModelFor(context),
        athleteAnswers: context.answers,
        activities: context.activities,
        manualActivities: context.manualActivities,
        activityComments: context.activityComments,
        weeklyNote: context.weeklyNote,
        ...(context.dailyHealth !== undefined
          ? { dailyHealth: context.dailyHealth }
          : {}),
        ...(context.events !== undefined ? { events: context.events } : {}),
        ...(context.diet !== undefined ? { diet: context.diet } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      if (captured !== undefined && captured.length > 0) {
        input.context = mergeCapturedPeriodReviews(input.context, captured);
        context = input.context;
      }
      await ensureCurrent();
    }

    const inputsChanged =
      input.plan !== null &&
      context.coachingInputsUpdatedAt !== null &&
      (input.plan.coachingInputsUpdatedAt === null ||
        context.coachingInputsUpdatedAt.getTime() >
          input.plan.coachingInputsUpdatedAt.getTime());
    // Compare against the analyses included in the plan, not when the plan was
    // saved: an import can finish while a generation is running, so the plan
    // may be newer than its save time yet still not contain the activity.
    const activitiesChanged =
      input.plan !== null &&
      context.activitiesUpdatedAt != null &&
      (input.plan.activitiesUpdatedAt === null ||
        context.activitiesUpdatedAt.getTime() >
          input.plan.activitiesUpdatedAt.getTime());
    // A newly generated week review, or an answer to one, makes the block
    // pending. The block is revised in place when today is still inside it.
    const weekReviewPending =
      input.plan !== null &&
      context.weekReviewUpdatedAt != null &&
      (input.plan.coachingInputsUpdatedAt === null ||
        context.weekReviewUpdatedAt.getTime() >
          input.plan.coachingInputsUpdatedAt.getTime());
    // A newly generated block review, or an answer to one, refreshes the
    // remaining season around what the completed block achieved.
    const blockReviewPending =
      input.plan !== null &&
      context.blockReviewUpdatedAt != null &&
      (input.plan.coachingInputsUpdatedAt === null ||
        context.blockReviewUpdatedAt.getTime() >
          input.plan.coachingInputsUpdatedAt.getTime());
    const revisionNeeded =
      inputsChanged || activitiesChanged || weekReviewPending;
    // An explicit update, a saved answer, or a completed block's review
    // refreshes the existing season instead of silently starting a new one.
    // Without a season that covers today there is nothing to refresh.
    const refreshRequested =
      mode === "updateSeason" ||
      (mode === "auto" && (stale || blockReviewPending));
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

    if (needsFullPlan || refreshSeason) {
      await clearPendingCoachQuestions(input);
    }

    if (needsFullPlan) {
      await generations.update(userId, PLAN_GENERATION_STEPS.review, runId);
      await generations.update(userId, PLAN_GENERATION_STEPS.season, runId);
      const seasonUpdate = await generateSeasonPlan(
        context.provider,
        credentials(context, seasonModelFor(context)),
        baseContext(input),
      );
      await recordCoachQuestion(
        input,
        seasonUpdate.coachQuestion,
        "season_plan",
        seasonModelFor(context),
      );
      const season: SeasonPlan = seasonUpdate.season;

      await generations.update(
        userId,
        PLAN_GENERATION_STEPS.initialBlock,
        runId,
      );
      const generatedBlock = await generateInitialBlock(
        context.provider,
        credentials(context, seasonModelFor(context)),
        { ...baseContext(input), season },
      );
      await recordCoachQuestion(
        input,
        generatedBlock.coachQuestion,
        "initial_block",
        seasonModelFor(context),
      );
      const block: BlockPlan = generatedBlock.block;
      const foundBodyMetrics: readonly BodyMetricEstimate[] = mergeBodyMetrics(
        seasonUpdate.bodyMetrics,
        generatedBlock.bodyMetrics,
      );

      await generations.update(
        userId,
        PLAN_GENERATION_STEPS.initialWeek,
        runId,
      );
      const weekUpdate = await generateWeeklyUpdate(
        context.provider,
        credentials(context, dailyModelFor(context)),
        {
          ...baseContext(input),
          ...weatherContext(input),
          season,
          block,
          weekStartDate: startOfWeek(today),
        },
      );
      await recordCoachQuestion(
        input,
        weekUpdate.coachQuestion,
        "weekly_update",
        dailyModelFor(context),
      );

      await generations.update(userId, PLAN_GENERATION_STEPS.day, runId);
      const dayUpdate = await generateDailyUpdate(
        context.provider,
        credentials(context, dailyModelFor(context)),
        {
          ...baseContext(input),
          ...weatherContext(input),
          season,
          block: weekUpdate.block,
          week: weekUpdate.week,
        },
      );
      await recordCoachQuestion(
        input,
        dayUpdate.coachQuestion,
        "daily_update",
        dailyModelFor(context),
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
        diet: dayUpdate.diet ?? null,
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
      const withProgress = await ensureDietProgress(input, completed);
      const generated = withTrainingLoad(
        applyForecastToPlan(
          dropUnplacedTomorrow(
            outlineWeekPlans(syncDietProgressTargets(withProgress)),
            input.includeTomorrow === true,
          ),
          forecastForStorage(context),
        ),
        context,
      );
      assertPlanValid(generated, today, input.includeTomorrow === true);
      await ensureCurrent();
      await generations.update(userId, PLAN_GENERATION_STEPS.save, runId);
      const saved = await plans.save(
        userId,
        generated,
        context.answersUpdatedAt,
        context.coachingInputsUpdatedAt,
        context.activitiesUpdatedAt ?? null,
        runId,
      );
      if (saved === null) {
        throw new GenerationSupersededError();
      }
      await clearSurveyAdjustments(input);
      await ensureCurrent();
      await persistFtpEstimates(input, generated);
      await persistBodyMetrics(input, generated);
      await generations.finish(userId, runId);
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
        weekReviewPending,
        context.dietAdvice === true,
      );
      const plan = await advancePlan(
        input,
        currentPlan,
        pending,
        revisionNeeded,
        true,
        weekReviewPending,
      );
      await ensureCurrent();
      await generations.update(userId, PLAN_GENERATION_STEPS.save, runId);
      const saved = await plans.save(
        userId,
        plan,
        context.answersUpdatedAt,
        context.coachingInputsUpdatedAt,
        context.activitiesUpdatedAt ?? null,
        runId,
      );
      if (saved === null) {
        throw new GenerationSupersededError();
      }
      await clearSurveyAdjustments(input);
      await ensureCurrent();
      await persistFtpEstimates(input, plan);
      await persistBodyMetrics(input, plan);
      await generations.finish(userId, runId);
      return saved;
    }

    const pending = planPending(
      currentPlan,
      today,
      input.includeTomorrow,
      weatherChanged,
      weekReviewPending,
      context.dietAdvice === true,
    );
    if (
      !pending.block &&
      !pending.week &&
      !pending.day &&
      !pending.tomorrow &&
      !pending.nextWeek &&
      !pending.nextBlock &&
      !pending.dietProgress &&
      !revisionNeeded
    ) {
      if (promoted && input.plan !== null) {
        // Persist the promotion and keep the timestamps that describe what the
        // current plan actually includes.
        await ensureCurrent();
        const saved = await plans.save(
          userId,
          withTrainingLoad(currentPlan, context),
          input.plan.answersUpdatedAt,
          input.plan.coachingInputsUpdatedAt,
          input.plan.activitiesUpdatedAt,
          runId,
        );
        if (saved === null) {
          throw new GenerationSupersededError();
        }
        await generations.finish(userId, runId);
        return saved;
      }
      await generations.finish(userId, runId);
      return input.plan;
    }

    const plan = await advancePlan(
      input,
      currentPlan,
      pending,
      revisionNeeded,
      false,
      weekReviewPending,
    );
    await ensureCurrent();
    await generations.update(userId, PLAN_GENERATION_STEPS.save, runId);
    const saved = await plans.save(
      userId,
      plan,
      context.answersUpdatedAt,
      context.coachingInputsUpdatedAt,
      context.activitiesUpdatedAt ?? null,
      runId,
    );
    if (saved === null) {
      throw new GenerationSupersededError();
    }
    await ensureCurrent();
    await persistFtpEstimates(input, plan);
    await persistBodyMetrics(input, plan);
    await generations.finish(userId, runId);
    return saved;
  } catch (err) {
    // A superseded run unwinds silently: the newer run owns the status row,
    // the prompt log, and every later write.
    if (isGenerationSuperseded(err) || input.signal?.aborted === true) {
      return null;
    }
    const message =
      err instanceof Error ? err.message : "The plan could not be generated.";
    const startedAt = await generations.fail(userId, message, runId);
    if (startedAt !== null) {
      await input.markPromptsFailed?.(userId, startedAt, message);
    }
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
  /** A full week or block revision makes the stored next period stale. */
  clearNextPeriod: boolean;
  /** Refresh the diet progress targets on every level. */
  progress: boolean;
}

interface PlanUpdateOptions {
  expectedBlockStartDate?: string;
  nextBlockStartDate?: string;
  nextWeekStartDate?: string;
  /** Revise the current block in place instead of creating a new one. */
  reviseBlock?: boolean;
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
  weekReviewPending = false,
): Promise<CoachPlan> {
  const { today, context } = input;
  const includeTomorrow = input.includeTomorrow === true;
  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = weekFor(current, tomorrowDate);
  const blockInPlace =
    weekReviewPending &&
    !seasonRefresh &&
    today >= current.block.startDate &&
    today <= current.block.endDate;
  const blockRevision = seasonRefresh || pending.block || weekReviewPending;
  const nextBlockRevision =
    includeTomorrow && pending.nextBlock && (seasonRefresh || !blockRevision);
  const nextBlockSameWeek =
    nextBlockRevision &&
    tomorrowWeek !== null &&
    tomorrowWeek.startDate === current.week.startDate;
  // A new day revises today's session and the rest of the week around it. A
  // next-block transition that lands in the current week revises the week but
  // deliberately keeps today's session.
  const weekRevision =
    seasonRefresh ||
    blockRevision ||
    revisionNeeded ||
    pending.week ||
    pending.day ||
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
    clearNextPeriod:
      seasonRefresh ||
      blockRevision ||
      revisionNeeded ||
      pending.week ||
      nextBlockRevision,
    progress: true,
  };
  const options: PlanUpdateOptions = {
    ...(seasonRefresh || blockInPlace
      ? { expectedBlockStartDate: current.block.startDate }
      : blockRevision
        ? { expectedBlockStartDate: nextBlockStartDate(current.block, today) }
        : {}),
    ...(blockInPlace ? { reviseBlock: true } : {}),
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
  const finalPlan = syncDietProgressTargets(
    withTrainingLoad(
      applyForecastToPlan(
        dropUnplacedTomorrow(
          outlineWeekPlans(plan),
          input.includeTomorrow === true,
        ),
        forecastForStorage(context),
      ),
      context,
    ),
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
  const revision: PlanUpdateRevision = {
    season: flags.season,
    block: flags.block,
    week: flags.week,
    day: flags.day,
    tomorrow: flags.tomorrow,
    nextWeek: flags.nextWeek,
    nextBlock: flags.nextBlock,
    progress: flags.progress,
  };
  await generations.update(
    userId,
    flags.season
      ? PLAN_GENERATION_STEPS.seasonRefresh
      : PLAN_GENERATION_STEPS.planUpdate,
    input.runId,
  );
  const update = await generatePlanUpdate(
    context.provider,
    credentials(
      context,
      flags.season || flags.block || flags.nextBlock
        ? seasonModelFor(context)
        : dailyModelFor(context),
    ),
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
      ...(flags.season &&
      context.coachingSurveyAdjustments !== undefined &&
      context.coachingSurveyAdjustments.length > 0
        ? { coachingSurveyAdjustments: context.coachingSurveyAdjustments }
        : {}),
      ...(options.expectedBlockStartDate !== undefined
        ? { blockStartDate: options.expectedBlockStartDate }
        : {}),
      ...(options.reviseBlock === true ? { reviseBlock: true } : {}),
      ...(options.nextBlockStartDate !== undefined
        ? { nextBlockStartDate: options.nextBlockStartDate }
        : {}),
      ...(options.nextWeekStartDate !== undefined
        ? { nextWeekStartDate: options.nextWeekStartDate }
        : {}),
    },
  );
  await recordCoachQuestion(
    input,
    update.coachQuestion,
    "plan_update",
    flags.season || flags.block || flags.nextBlock
      ? seasonModelFor(context)
      : dailyModelFor(context),
  );
  return applyPlanUpdate(input, current, update, flags, options);
}

/** Applies the levels the update prompt revised and keeps the rest stored. */
function applyPlanUpdate(
  input: GeneratePlanInput,
  current: CoachPlan,
  update: CoachPlan,
  revision: PlanUpdateFlags,
  options: PlanUpdateOptions,
): CoachPlan {
  const { today } = input;
  let plan: CoachPlan = { ...current };

  if (revision.season) {
    const season = withStoredIntroduction(
      withCompletedSeasonBlocks(update.season, current.season, today),
      current.season,
    );
    assertRefreshedSeason(season, update.block, today, current.block.startDate);
    plan = { ...plan, season, block: update.block };
  } else if (revision.block) {
    plan = {
      ...plan,
      season: withStoredIntroduction(update.season, current.season),
      block: update.block,
    };
  } else if (revision.nextBlock) {
    plan = {
      ...plan,
      season: withStoredIntroduction(update.season, current.season),
    };
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

  if (revision.clearNextPeriod && !revision.nextBlock) {
    plan = { ...plan, nextBlock: null };
  }
  if (revision.clearNextPeriod && !revision.nextWeek) {
    plan = { ...plan, nextWeek: null };
  }
  if (revision.nextBlock) {
    plan = { ...plan, nextBlock: update.nextBlock };
  }
  if (revision.nextWeek) {
    plan = { ...plan, nextWeek: update.nextWeek };
  }

  if (revision.clearNextPeriod && !revision.tomorrow) {
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
      plan = {
        ...plan,
        week: withOutlineSession(plan.week, update.week, plan.tomorrow.date),
      };
    } else {
      const source = update.nextWeek;
      if (source !== null) {
        plan = {
          ...plan,
          nextWeek: withOutlineSession(
            plan.nextWeek ?? source,
            source,
            plan.tomorrow.date,
          ),
        };
      }
    }
  }

  if (revision.week && !revision.day) {
    plan = {
      ...plan,
      week: restoreTodaysSession(plan.week, current, today),
      today: current.today,
    };
  }

  plan = mergeDietProgressTargets(plan, update);

  return {
    ...plan,
    diet: update.diet ?? plan.diet,
    bodyMetrics: mergeBodyMetrics(current.bodyMetrics, update.bodyMetrics),
  };
}

/**
 * Replaces one dated week session with the coach's returned outline. The week
 * keeps its other sessions and its overview level; only the named day moves.
 */
function withOutlineSession(
  week: WeekPlan,
  source: WeekPlan,
  date: string,
): WeekPlan {
  const session = source.sessions.find((entry) => entry.date === date);
  if (session === undefined) {
    return week;
  }
  return {
    ...week,
    sessions: week.sessions.map((entry) =>
      entry.date === date ? session : entry,
    ),
  };
}

/**
 * A full build generates the season and block before the daily update knows
 * whether the athlete stated a diet goal. When the finished draft has a stated
 * goal and a current or future period without a target, make one progress-only
 * update so the saved plan is complete on the first visit. A failure leaves the
 * draft in place; the next plan visit sees the missing target as pending.
 */
async function ensureDietProgress(
  input: GeneratePlanInput,
  plan: CoachPlan,
): Promise<CoachPlan> {
  if (
    input.context.dietAdvice !== true ||
    !dietProgressPending(plan, true, input.today)
  ) {
    return plan;
  }
  try {
    return await requestPlanUpdate(
      input,
      plan,
      {
        season: false,
        block: false,
        week: false,
        day: false,
        tomorrow: false,
        nextWeek: false,
        nextBlock: false,
        clearNextPeriod: false,
        progress: true,
      },
      {},
    );
  } catch (err) {
    if (isGenerationSuperseded(err) || input.signal?.aborted === true) {
      throw err;
    }
    console.error("[plan] could not refresh diet progress:", err);
    return plan;
  }
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
  const pending = planPending(
    plan,
    input.today,
    true,
    false,
    false,
    input.context.dietAdvice === true,
  );
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
      clearNextPeriod: pending.nextBlock,
      progress: true,
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
  return activitiesOn(context, date).length > 0;
}

interface CompletionActivity {
  type: string;
  elapsedTime: number;
}

/**
 * Every synced or manually recorded activity on `date`. A day can prescribe
 * more than one session, so completion is judged against all of them together.
 */
function activitiesOn(
  context: PlanGenerationContext,
  date: string,
): CompletionActivity[] {
  const synced = context.activities
    .filter((activity) => activity.startDate.slice(0, 10) === date)
    .map((activity) => ({
      type: activity.type,
      elapsedTime: activity.elapsedTime,
    }));
  const manual = context.manualActivities
    .filter((activity) => activity.startDate.slice(0, 10) === date)
    .map(() => ({ type: "manual", elapsedTime: 0 }));
  return [...synced, ...manual];
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
  const activities = activitiesOn(context, today);
  if (activities.length === 0) {
    return {
      ...plan,
      status: plan.type === "rest" ? "rest" : "planned",
    };
  }
  if (plan.status === "completed" || plan.status === "partial") {
    return plan;
  }
  return { ...plan, status: completionStatus(planned, activities) };
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
 * Keeps the greeting from the season the coach first planned. A refresh or a
 * block update returns the season without needing to repeat the introduction,
 * and an omitted greeting must not make the coach introduce themselves again.
 */
function withStoredIntroduction(
  season: SeasonPlan,
  previous: SeasonPlan,
): SeasonPlan {
  return {
    ...season,
    introduction: season.introduction ?? previous.introduction ?? null,
  };
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
 * Whether the refreshed blocks tile the season is checked for every write in
 * `assertSeasonBlocksContiguous`.
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
 * Season blocks tile the season: each block starts the day after the previous
 * one ends. A shared day puts a date in two blocks and a skipped day leaves it
 * in none, so both are rejected on every write — a build, a season refresh and
 * a block, week or day update that returns the season alike. Without this a
 * week or block update could store overlapping blocks that every later season
 * refresh then reproduced. Blocks that ended before today are stored history
 * the coach cannot change, so their boundaries are not re-checked.
 */
function assertSeasonBlocksContiguous(season: SeasonPlan, today: string): void {
  const upcoming = season.blocks.filter((entry) => entry.endDate >= today);
  for (let index = 1; index < upcoming.length; index += 1) {
    const previous = upcoming[index - 1];
    const next = upcoming[index];
    if (previous === undefined || next === undefined) {
      continue;
    }
    if (next.startDate <= previous.endDate) {
      throw new Error(
        `The coach returned overlapping season blocks: "${next.name}" starts on ${next.startDate}, the day "${previous.name}" ends. Please regenerate the plan.`,
      );
    }
    const unplanned = addDays(previous.endDate, 1);
    if (next.startDate !== unplanned) {
      throw new Error(
        `The coach returned a gap between season blocks: "${previous.name}" ends on ${previous.endDate} and "${next.name}" starts on ${next.startDate}, leaving ${unplanned} unplanned. Please regenerate the plan.`,
      );
    }
  }
}

/**
 * Guards against a model that returns a plan for the wrong date. Without this
 * the pending check would immediately ask for another generation and loop.
 * Every write path ends here, so the season's block boundaries are checked
 * here too.
 */
function assertPlanValid(
  plan: CoachPlan,
  today: string,
  includeTomorrow: boolean,
): void {
  const calorieProblem = calorieEstimateProblems(plan)[0];
  if (calorieProblem !== undefined) {
    throw new Error(`${calorieProblem.message} Please regenerate the plan.`);
  }
  assertSeasonBlocksContiguous(plan.season, today);
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

function seasonModelFor(context: PlanGenerationContext): string {
  return context.seasonModel ?? context.model;
}

function dailyModelFor(context: PlanGenerationContext): string {
  return context.dailyModel ?? context.model;
}

function credentials(context: PlanGenerationContext, model = context.model) {
  return {
    apiKey: context.apiKey,
    model,
    ...(context.signal !== undefined ? { signal: context.signal } : {}),
  };
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
 * Adds reviews generated at the start of this run to the context before the
 * plan update. A new week review also advances the coaching-input timestamp, so
 * the saved plan records that it already used the review.
 */
function mergeCapturedPeriodReviews(
  context: PlanGenerationContext,
  captured: readonly PeriodReviewContext[],
): PlanGenerationContext {
  const capturedAt = (kind: "week" | "block"): Date | null => {
    const review = captured.find((entry) => entry.kind === kind);
    if (review === undefined) {
      return null;
    }
    const at =
      review.updatedAt === undefined ? new Date() : new Date(review.updatedAt);
    return Number.isNaN(at.getTime()) ? null : at;
  };
  const weekReviewUpdatedAt =
    capturedAt("week") ?? context.weekReviewUpdatedAt ?? null;
  const blockReviewUpdatedAt =
    capturedAt("block") ?? context.blockReviewUpdatedAt ?? null;
  return {
    ...context,
    periodReviews: [...(context.periodReviews ?? []), ...captured],
    weekReviewUpdatedAt,
    blockReviewUpdatedAt,
    coachingInputsUpdatedAt: latestDate(
      latestDate(context.coachingInputsUpdatedAt, weekReviewUpdatedAt),
      blockReviewUpdatedAt,
    ),
  };
}

function latestDate(
  first: Date | null | undefined,
  second: Date | null | undefined,
): Date | null {
  if (first == null) {
    return second ?? null;
  }
  if (second == null) {
    return first;
  }
  return second.getTime() > first.getTime() ? second : first;
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
    thresholdTimelines: context.thresholdTimelines,
  });
}

/**
 * The current FTP for prompts and TSS. It comes only from the stored metric
 * series: the coach read the athlete's stated FTP and the API stored it, so no
 * free text is parsed here.
 */
function ftpBaseline(context: PlanGenerationContext, today: string) {
  return ftpBaselineAt(ftpTimeline(context.thresholdTimelines ?? []), today);
}

function baseContext(input: GeneratePlanInput) {
  const recentActivities: RecentActivityContext[] =
    input.context.activities.map(toCoachPlanActivity);
  // Prefer the stored plan's snapshot because it includes today's planned
  // session; fall back to the recorded history for a plan that has none yet.
  const storedForm =
    input.plan?.plan.today.date === input.today
      ? (input.plan.plan.today.trainingLoad ?? null)
      : null;
  const currentForm =
    storedForm ??
    currentTrainingLoad(
      {
        activities: input.context.activities,
        manualActivities: input.context.manualActivities,
        thresholdTimelines: input.context.thresholdTimelines,
      },
      input.today,
    );

  return {
    athleteAnswers: input.context.answers,
    recentActivities,
    ...(currentForm !== null ? { currentForm } : {}),
    athleteFtpWatts: ftpBaseline(input.context, input.today)?.watts ?? null,
    ...(input.context.ftpHistory !== undefined
      ? { ftpHistory: input.context.ftpHistory }
      : {}),
    ...(input.context.thresholds !== undefined
      ? { thresholds: input.context.thresholds }
      : {}),
    ...(input.context.bodyHistory !== undefined
      ? { bodyHistory: input.context.bodyHistory }
      : {}),
    ...(input.context.dailyHealth !== undefined
      ? { dailyHealth: input.context.dailyHealth }
      : {}),
    ...(input.context.events !== undefined && input.context.events.length > 0
      ? { events: input.context.events }
      : {}),
    ...(input.context.diet !== undefined ? { diet: input.context.diet } : {}),
    ...(input.context.dietGoal !== undefined
      ? { dietGoal: input.context.dietGoal }
      : {}),
    ...(input.context.dietAdvice !== undefined
      ? { dietAdvice: input.context.dietAdvice }
      : {}),
    ...(input.context.calorieHistory !== undefined &&
    input.context.calorieHistory.length > 0
      ? { calorieHistory: input.context.calorieHistory }
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
      ? {
          weeklyNote: input.context.weeklyNote,
          ...(input.context.weeklyNoteWeekStartDate != null
            ? { weeklyNoteWeekStartDate: input.context.weeklyNoteWeekStartDate }
            : {}),
        }
      : {}),
    ...(input.context.weeklyNoteReply != null
      ? { weeklyNoteReply: input.context.weeklyNoteReply }
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

/** Clears consumed survey adjustments without letting a failure fail the plan. */
async function clearSurveyAdjustments(input: GeneratePlanInput): Promise<void> {
  if (
    input.clearCoachingSurveyAdjustments === undefined ||
    input.context.coachingSurveyAdjustments === undefined ||
    input.context.coachingSurveyAdjustments.length === 0
  ) {
    return;
  }
  try {
    await input.clearCoachingSurveyAdjustments();
  } catch (err) {
    console.error("[plan] could not clear survey adjustments:", err);
  }
}

/**
 * Drops unanswered questions before a new season or season refresh, without
 * letting a failure stop the plan. A question the same run asks is stored after
 * this clear, so only questions about the replaced plan disappear.
 */
async function clearPendingCoachQuestions(
  input: GeneratePlanInput,
): Promise<void> {
  if (input.clearCoachQuestions === undefined) {
    return;
  }
  if (!(await input.generations.isCurrent(input.userId, input.runId))) {
    throw new GenerationSupersededError();
  }
  try {
    await input.clearCoachQuestions();
  } catch (err) {
    console.error("[plan] could not clear coach questions:", err);
  }
}

/** Stores a clarification question without letting a failure fail the plan. */
async function recordCoachQuestion(
  input: GeneratePlanInput,
  question: string | null | undefined,
  sourceKind: CoachQuestionSourceKind,
  model: string,
): Promise<void> {
  if (
    input.recordCoachQuestion === undefined ||
    question === undefined ||
    question === null
  ) {
    return;
  }
  if (!(await input.generations.isCurrent(input.userId, input.runId))) {
    throw new GenerationSupersededError();
  }
  try {
    await input.recordCoachQuestion({
      question,
      model,
      sourceKind,
    });
  } catch (err) {
    console.error("[plan] could not store coach questions:", err);
  }
}
