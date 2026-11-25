import type { CoachPlan } from "@killingit/shared";
import { addDays, startOfWeek } from "@killingit/shared";
import {
  generateDailyUpdate,
  generatePlanUpdate,
} from "../../llm/planUpdate.js";
import { COACH_PLAN_FINALISATION, finalizePlan } from "../finalize.js";
import { nextBlockStartDate } from "../periods.js";
import { PlanValidationError } from "../planValidationError.js";
import {
  planUpdateRevision,
  revisionFlags,
  type PlanUpdateFlags,
} from "../revision.js";
import { PLAN_GENERATION_STEPS } from "../steps.js";
import {
  applyDailyUpdate,
  applyPlanUpdate,
  hasActivityOn,
  restoreTodaysSession,
} from "./applyUpdate.js";
import { finalizeInput } from "./finalize.js";
import { recordCoachQuestion } from "./persist.js";
import {
  baseContext,
  credentials,
  dailyModelFor,
  seasonModelFor,
  weatherContext,
} from "./promptContext.js";
import type { GeneratePlanInput, RevisionDecision } from "./types.js";

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
 * old block → week → day cascade. A refresh decision revises the season in
 * place; an advance only fills in what is pending.
 */
export async function advancePlan(
  input: GeneratePlanInput,
  current: CoachPlan,
  decision: RevisionDecision,
): Promise<CoachPlan> {
  const { today, context } = input;
  const includeTomorrow = input.includeTomorrow === true;
  const tomorrowDate = addDays(today, 1);
  const flags = revisionFlags({
    current,
    pending: decision.pending,
    decision,
    today,
    includeTomorrow,
    keepToday: input.keepToday === true,
  });
  const expectedSeasonBlockStart =
    current.block.endDate < today
      ? startOfWeek(today)
      : current.block.startDate;
  const options: PlanUpdateOptions = {
    ...(flags.season || flags.blockInPlace
      ? { expectedBlockStartDate: expectedSeasonBlockStart }
      : flags.block
        ? { expectedBlockStartDate: nextBlockStartDate(current.block, today) }
        : {}),
    ...(flags.blockInPlace ? { reviseBlock: true } : {}),
    ...(flags.nextBlock
      ? { nextBlockStartDate: nextBlockStartDate(current.block, today) }
      : {}),
    ...(flags.nextWeek ? { nextWeekStartDate: startOfWeek(tomorrowDate) } : {}),
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

  const finalPlan = finalizePlan(
    plan,
    {
      ...finalizeInput(input),
      // The stored session is what the athlete was asked to do, so a revised
      // today is judged against it rather than against the new proposal.
      ...(current.today.date === today ? { plannedToday: current.today } : {}),
    },
    COACH_PLAN_FINALISATION,
  );
  if (input.includeTomorrow === true && finalPlan.tomorrow === null) {
    throw new PlanValidationError(
      "The coach did not return tomorrow's session.",
    );
  }
  return finalPlan;
}

/**
 * True when the revision changes only today, the week around it and tomorrow. A
 * week-only, next-period, progress-only or season/block revision needs the full
 * plan prompt because the daily prompt returns no season, block, next week or
 * next block. See ADR 0062.
 */
function isDayOnlyRevision(flags: PlanUpdateFlags): boolean {
  return (
    flags.day &&
    !flags.season &&
    !flags.block &&
    !flags.nextBlock &&
    !flags.nextWeek
  );
}

/**
 * Runs the prompt a revision needs and applies only the requested levels. A
 * day-only revision uses the daily prompt; every wider revision uses the full
 * plan-update prompt.
 */
export async function requestPlanUpdate(
  input: GeneratePlanInput,
  current: CoachPlan,
  flags: PlanUpdateFlags,
  options: PlanUpdateOptions,
): Promise<CoachPlan> {
  const { userId, context, generations } = input;
  const revision = planUpdateRevision(flags);
  const model =
    flags.season || flags.block || flags.nextBlock
      ? seasonModelFor(context)
      : dailyModelFor(context);
  await generations.update(
    userId,
    flags.season
      ? PLAN_GENERATION_STEPS.seasonRefresh
      : PLAN_GENERATION_STEPS.planUpdate,
    input.runId,
  );
  if (isDayOnlyRevision(flags)) {
    const update = await generateDailyUpdate(
      context.provider,
      credentials(context, model),
      {
        ...baseContext(input),
        ...weatherContext(input),
        season: current.season,
        block: current.block,
        week: current.week,
        todayPlan: current.today.date === input.today ? current.today : null,
      },
    );
    await recordCoachQuestion(
      input,
      update.coachQuestion,
      "daily_update",
      model,
    );
    return applyDailyUpdate(input, current, update, flags);
  }
  const update = await generatePlanUpdate(
    context.provider,
    credentials(context, model),
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
      blockStartDate: options.expectedBlockStartDate,
      ...(options.reviseBlock === true ? { reviseBlock: true } : {}),
      nextBlockStartDate: options.nextBlockStartDate,
      nextWeekStartDate: options.nextWeekStartDate,
    },
  );
  await recordCoachQuestion(input, update.coachQuestion, "plan_update", model);
  return applyPlanUpdate(input, current, update, flags, options);
}
