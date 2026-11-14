import type { BlockPlan, CoachPlan, SeasonPlan } from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import {
  generateInitialBlock,
  generateSeasonPlan,
} from "../../llm/planInitial.js";
import {
  generateDailyUpdate,
  generateWeeklyUpdate,
} from "../../llm/planUpdate.js";
import { dietProgressPending } from "../dietProgress.js";
import {
  COACH_PLAN_FINALISATION,
  SETTLEMENT_FINALISATION,
  finalizePlan,
} from "../finalize.js";
import { isGenerationSuperseded } from "../generation.js";
import { nextBlockStartDate, weekFor } from "../periods.js";
import { planPending } from "../status.js";
import { PLAN_GENERATION_STEPS } from "../steps.js";
import { mergeBodyMetrics } from "./applyUpdate.js";
import { finalizeInput } from "./finalize.js";
import { recordCoachQuestion } from "./persist.js";
import {
  baseContext,
  credentials,
  dailyModelFor,
  seasonModelFor,
  weatherContext,
} from "./promptContext.js";
import { requestPlanUpdate } from "./revision.js";
import type { GeneratePlanInput } from "./types.js";

/**
 * Builds a new plan: season, block, week, then day, with tomorrow and the next
 * period when they are wanted. Completed days, diet targets, the forecast and
 * the training load are attached before the plan is validated.
 */
export async function generateFreshPlan(
  input: GeneratePlanInput,
): Promise<CoachPlan> {
  const { context, generations, runId, today, userId } = input;

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

  await generations.update(userId, PLAN_GENERATION_STEPS.initialBlock, runId);
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
  const foundBodyMetrics = mergeBodyMetrics(
    seasonUpdate.bodyMetrics,
    generatedBlock.bodyMetrics,
  );

  await generations.update(userId, PLAN_GENERATION_STEPS.initialWeek, runId);
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

  const draft: CoachPlan = {
    season,
    block: weekUpdate.block,
    week: dayUpdate.week,
    today: dayUpdate.today,
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
  // The recorded completion settles before anything else reads the plan, and
  // before a next-period or progress-only completion sees it.
  const settled = finalizePlan(
    draft,
    finalizeInput(input),
    SETTLEMENT_FINALISATION,
  );
  const withNextPeriod =
    input.includeTomorrow === true
      ? await planNextPeriod(input, settled)
      : settled;
  const withProgress = await ensureDietProgress(input, withNextPeriod);
  return finalizePlan(
    withProgress,
    finalizeInput(input),
    COACH_PLAN_FINALISATION,
  );
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
  const pending = planPending({
    plan,
    today: input.today,
    includeTomorrow: true,
    dietAdvice: input.context.dietAdvice === true,
  });
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
      blockInPlace: false,
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
        blockInPlace: false,
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
