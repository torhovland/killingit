import type { CoachPlan, DietPlan } from "@killingit/shared";
import type { z } from "zod";
import { addDays, startOfWeek, weekDates } from "@killingit/shared";
import { isDietGoalProvided } from "../diet/goal.js";
import {
  dietGoalProblems,
  dietProgressConsistencyProblems,
  missingDietProgressTargets,
} from "../plans/dietProgress.js";
import type { LlmProvider } from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
import { PLAN_MAX_TOKENS } from "./planBudget.js";
import type { CompletionCredentials } from "./resilientCompletion.js";
import {
  dailyPlanUpdateSchema,
  planUpdateResponseSchema,
  weeklyPlanUpdateSchema,
  type DailyPlanUpdate,
  type PlanUpdateResponse,
  type WeeklyPlanUpdate,
} from "./planResult.js";
import {
  buildDailyUpdateMessages,
  buildPlanUpdateMessages,
  buildWeeklyUpdateMessages,
  planUpdateResponseLevels,
  type DailyUpdateInput,
  type PlanUpdateInput,
  type PlanUpdateResponseLevels,
  type WeeklyUpdateInput,
} from "./planUpdatePrompt.js";
import {
  addCalorieEstimateIssues,
  type CalorieBearingPlan,
} from "../plans/calorieEstimates.js";
import {
  DIET_PROGRESS_REPAIR_HINT,
  DIET_REPAIR_HINT,
  missingDietGoalMessage,
  missingDietProgressMessage,
  weekDatesRule,
} from "./promptRules.js";

interface DatedWeek {
  startDate: string;
  sessions: readonly { date: string }[];
}

function hasWeekDates(week: DatedWeek, startDate: string): boolean {
  const dates = weekDates(startDate);
  return (
    week.startDate === startDate &&
    dates.every((date) =>
      week.sessions.some((session) => session.date === date),
    )
  );
}

/**
 * Adds the concrete date requirement to a schema. The generic "must be one of
 * the week's sessions" error does not tell the model which dates to use, so the
 * repair turn repeats the exact week.
 */
function withWeekDates<T extends { week?: DatedWeek | undefined }>(
  schema: z.ZodType<T>,
  startDate: string,
): z.ZodType<T> {
  return schema.refine(
    (value) => value.week === undefined || hasWeekDates(value.week, startDate),
    {
      message: weekDatesRule(startDate),
      path: ["week", "sessions"],
    },
  );
}

function withNextWeekDates<
  T extends { nextWeek?: DatedWeek | null | undefined },
>(schema: z.ZodType<T>, startDate: string | null): z.ZodType<T> {
  return schema.refine(
    (value) =>
      startDate === null ||
      value.nextWeek == null ||
      hasWeekDates(value.nextWeek, startDate),
    {
      message:
        startDate === null
          ? "The next week must start on a Monday"
          : weekDatesRule(startDate, "next week"),
      path: ["nextWeek", "sessions"],
    },
  );
}

function withTomorrowPlacement<
  T extends {
    tomorrow?: { date: string } | null | undefined;
    week?: DatedWeek | undefined;
    nextWeek?: DatedWeek | null | undefined;
  },
>(schema: z.ZodType<T>, input: PlanUpdateInput): z.ZodType<T> {
  return schema.refine(
    (value) => {
      if (value.tomorrow == null) {
        return true;
      }
      const week = value.week ?? input.week;
      const nextWeek =
        value.nextWeek === undefined ? input.nextWeek : value.nextWeek;
      return (
        week.sessions.some(
          (session) => session.date === value.tomorrow?.date,
        ) ||
        nextWeek?.sessions.some(
          (session) => session.date === value.tomorrow?.date,
        ) === true
      );
    },
    {
      message:
        "Tomorrow's session must be one of the current week's or the next week's sessions",
      path: ["tomorrow", "date"],
    },
  );
}

/**
 * Rejects a plan whose daily calorie estimate is too low to be a whole day's
 * intake, so the repair turn can ask the model for the real total instead of
 * storing a deficit or burned calories as the requirement.
 */
function withPlausibleCalories<T extends CalorieBearingPlan>(
  schema: z.ZodType<T>,
): z.ZodType<T> {
  return schema.superRefine((value, ctx) =>
    addCalorieEstimateIssues(value, ctx, { requireBreakdown: true }),
  );
}

/**
 * The full plan a partial answer would save: a level the answer omits keeps the
 * stored one, which is what the diet checks have to judge.
 */
function storedPlanFor(
  input: PlanUpdateInput,
  value: PlanUpdateResponse,
): CoachPlan {
  return {
    season: value.season ?? input.season,
    block: value.block ?? input.block,
    week: value.week ?? input.week,
    today: value.today ?? input.todayPlan,
    tomorrow: value.tomorrow === undefined ? input.tomorrow : value.tomorrow,
    nextWeek: value.nextWeek === undefined ? input.nextWeek : value.nextWeek,
    nextBlock:
      value.nextBlock === undefined ? input.nextBlock : value.nextBlock,
    diet: value.diet ?? input.dietGoal,
    bodyMetrics: value.bodyMetrics,
    coachQuestion: value.coachQuestion,
    modelsRemarks: value.modelsRemarks,
  };
}

/**
 * Rejects a plan that has a stated diet goal but leaves a current or future
 * period without a progress target. The check covers only the levels the
 * response carries: a level left out of the contract keeps its stored target,
 * and its absence must not fail validation. The repair turn asks for the missing
 * `dietProgress` objects instead of letting the coach store a plan whose
 * Season, Block or Week view silently has no target.
 */
function withRequiredDietProgress<T extends PlanUpdateResponse>(
  schema: z.ZodType<T>,
  input: PlanUpdateInput,
  levels: PlanUpdateResponseLevels,
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    if (input.dietAdvice !== true) {
      return;
    }
    const plan = storedPlanFor(input, value);
    for (const problem of dietProgressConsistencyProblems(plan, levels)) {
      ctx.addIssue({ code: "custom", message: problem });
    }
    if (input.dietGoal == null && plan.diet == null) {
      ctx.addIssue({
        code: "custom",
        message: missingDietGoalMessage(),
        path: ["diet"],
      });
      return;
    }
    const goal = effectiveDietGoal(input, plan);
    if (isDietGoalProvided(goal) !== true) {
      return;
    }
    for (const label of missingDietProgressTargets(plan, input.today, levels)) {
      ctx.addIssue({
        code: "custom",
        message: missingDietProgressMessage(label),
      });
    }
    if (levels.season && levels.block && levels.week) {
      for (const problem of dietGoalProblems(
        { ...plan, diet: goal },
        input.today,
      )) {
        ctx.addIssue({ code: "custom", message: problem });
      }
    }
  });
}

/**
 * The goal in a response, falling back to the stored goal for a numeric field
 * the response omitted. A response that sets a field to null clears it; only an
 * omitted field keeps the stored value, so a progress refresh cannot skip the
 * goal check by leaving the target out.
 */
function effectiveDietGoal(
  input: PlanUpdateInput,
  value: CoachPlan,
): DietPlan | null {
  const response = value.diet;
  const stored = input.dietGoal;
  if (response == null) {
    return stored ?? null;
  }
  if (stored == null) {
    return response;
  }
  return {
    ...stored,
    ...response,
    goalWeightKg:
      response.goalWeightKg !== undefined
        ? response.goalWeightKg
        : stored.goalWeightKg,
    goalBodyFatPercent:
      response.goalBodyFatPercent !== undefined
        ? response.goalBodyFatPercent
        : stored.goalBodyFatPercent,
    goalDate:
      response.goalDate !== undefined ? response.goalDate : stored.goalDate,
    goalMissReason:
      response.goalMissReason !== undefined
        ? response.goalMissReason
        : stored.goalMissReason,
  };
}

/**
 * Rejects a daily update that has a stated diet goal but no target for the
 * week it returns. The weekly target is the day-level plan's only progress
 * field, so the repair turn can fill it before the block and season targets are
 * refreshed.
 */
function withRequiredWeekDietProgress<T extends DailyPlanUpdate>(
  schema: z.ZodType<T>,
  input: DailyUpdateInput,
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    if (input.dietAdvice !== true) {
      return;
    }
    if (value.diet == null) {
      ctx.addIssue({
        code: "custom",
        message: missingDietGoalMessage(),
        path: ["diet"],
      });
      return;
    }
    const goalProvided =
      value.diet.goalProvided ?? isDietGoalProvided(input.dietGoal);
    if (goalProvided === true && value.week.dietProgress == null) {
      ctx.addIssue({
        code: "custom",
        message: missingDietProgressMessage("the current week"),
        path: ["week", "dietProgress"],
      });
    }
  });
}

function weekDateHint(startDate: string): string {
  const dates = weekDates(startDate);
  return `${weekDatesRule(startDate)} (${dates[0]} through ${dates[6]}).`;
}

function dailyDateHint(today: string, startDate: string): string {
  return `The "today" object's date must be exactly ${today}, and week.sessions must contain a session with that exact date. ${weekDateHint(startDate)}`;
}

/** The date rules the repair turn repeats for the levels a response carries. */
function planUpdateDateHint(
  input: PlanUpdateInput,
  levels: PlanUpdateResponseLevels,
  weekStart: string,
  nextWeekStart: string | null,
): string[] {
  const hints: string[] = [];
  if (levels.week) {
    hints.push(weekDateHint(weekStart));
  }
  if (levels.today) {
    hints.push(
      `The "today" object's date must be exactly ${input.today}, and week.sessions must contain a session with that exact date.`,
    );
  }
  if (levels.tomorrow) {
    hints.push(
      `Tomorrow is ${addDays(input.today, 1)}; tomorrow's session must be in the current week or the next week${nextWeekStart === null ? "." : `, and the next week must start on ${nextWeekStart}.`}`,
    );
  }
  if (levels.nextWeek && nextWeekStart !== null) {
    hints.push(weekDateHint(nextWeekStart));
  }
  return hints;
}

/**
 * Asks the coach to update any combination of levels in one completion. The
 * prompt receives every current level and the revision request, and returns the
 * levels that revision changes; the API keeps the stored level the response
 * omits.
 */
export async function generatePlanUpdate(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: PlanUpdateInput,
): Promise<PlanUpdateResponse> {
  const weekStart = startOfWeek(input.today);
  const nextWeekStart = input.revision.nextWeek
    ? startOfWeek(addDays(input.today, 1))
    : null;
  const levels = planUpdateResponseLevels(input.revision);
  const responseSchema = withTomorrowPlacement(
    withPlausibleCalories(
      withNextWeekDates(
        withWeekDates(planUpdateResponseSchema(levels), weekStart),
        nextWeekStart,
      ),
    ),
    input,
  );
  const schema = withRequiredDietProgress(responseSchema, input, levels);
  return completePlanJson(
    schema,
    provider,
    credentials,
    buildPlanUpdateMessages(input),
    {
      maxTokens: PLAN_MAX_TOKENS,
      repairHint: `${planUpdateDateHint(input, levels, weekStart, nextWeekStart).join(" ")} When diet advice is on and no stored goal exists, return ${DIET_REPAIR_HINT}. When the athlete stated a diet goal, every returned current and future period must carry ${DIET_PROGRESS_REPAIR_HINT}.`,
      kind: "plan_update",
    },
  );
}

/** Asks the coach for today's session and a revised week. */
export async function generateDailyUpdate(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: DailyUpdateInput,
): Promise<DailyPlanUpdate> {
  const weekStartDate = startOfWeek(input.today);
  return completePlanJson(
    withRequiredWeekDietProgress(
      withWeekDates(
        withPlausibleCalories(dailyPlanUpdateSchema),
        weekStartDate,
      ),
      input,
    ),
    provider,
    credentials,
    buildDailyUpdateMessages(input),
    {
      maxTokens: PLAN_MAX_TOKENS,
      repairHint: `${dailyDateHint(input.today, weekStartDate)} When diet advice is on, return ${DIET_REPAIR_HINT}. When the athlete stated a diet goal, the week must carry ${DIET_PROGRESS_REPAIR_HINT}.`,
      kind: "daily_update",
    },
  );
}

/** Asks the coach for a new week and a revised block. */
export async function generateWeeklyUpdate(
  provider: LlmProvider,
  credentials: CompletionCredentials,
  input: WeeklyUpdateInput,
): Promise<WeeklyPlanUpdate> {
  return completePlanJson(
    withWeekDates(
      withPlausibleCalories(weeklyPlanUpdateSchema),
      input.weekStartDate,
    ),
    provider,
    credentials,
    buildWeeklyUpdateMessages(input),
    {
      maxTokens: PLAN_MAX_TOKENS,
      repairHint: weekDateHint(input.weekStartDate),
      kind: "weekly_update",
    },
  );
}
