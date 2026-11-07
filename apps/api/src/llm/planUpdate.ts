import {
  coachPlanSchema,
  dailyPlanUpdateSchema,
  isDefaultDietGoal,
  weeklyPlanUpdateSchema,
  type CoachPlan,
  type DailyPlanUpdate,
  type WeeklyPlanUpdate,
} from "@killingit/shared";
import type { z } from "zod";
import { addDays, startOfWeek, weekDates } from "../plans/dates.js";
import { missingDietProgressTargets } from "../plans/dietProgress.js";
import type { LlmProvider } from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
import { PLAN_MAX_TOKENS } from "./planBudget.js";
import {
  buildDailyUpdateMessages,
  buildPlanUpdateMessages,
  buildWeeklyUpdateMessages,
  type DailyUpdateInput,
  type PlanUpdateInput,
  type WeeklyUpdateInput,
} from "./planUpdatePrompt.js";
import {
  addCalorieEstimateIssues,
  type CalorieBearingPlan,
} from "../plans/calorieEstimates.js";

export interface PlanUpdateCredentials {
  apiKey: string;
  model: string;
  /** Cancels the completion when a newer coach run starts. */
  signal?: AbortSignal;
}

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
function withWeekDates<T extends { week: DatedWeek }>(
  schema: z.ZodType<T>,
  startDate: string,
): z.ZodType<T> {
  const dates = weekDates(startDate);
  return schema.refine((value) => hasWeekDates(value.week, startDate), {
    message: `The week must start on ${startDate} and contain exactly seven sessions dated ${dates.join(", ")}`,
    path: ["week", "sessions"],
  });
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
    addCalorieEstimateIssues(value, ctx),
  );
}

/**
 * Rejects a plan that has a stated diet goal but leaves a current or future
 * period without a progress target. The repair turn asks for the missing
 * `dietProgress` objects instead of letting the coach store a plan whose
 * Season, Block or Week view silently has no target.
 */
function withRequiredDietProgress<T extends CoachPlan>(
  schema: z.ZodType<T>,
  input: PlanUpdateInput,
): z.ZodType<T> {
  return schema.superRefine((value, ctx) => {
    if (input.dietAdvice !== true) {
      return;
    }
    if (input.dietGoal == null && value.diet == null) {
      ctx.addIssue({
        code: "custom",
        message:
          'Missing the diet goal. Return "diet" with "goal", "goalProvided" and "assessment".',
        path: ["diet"],
      });
      return;
    }
    const goalProvided =
      value.diet?.goalProvided ??
      (input.dietGoal == null
        ? undefined
        : (input.dietGoal.goalProvided ??
          !isDefaultDietGoal(input.dietGoal.goal)));
    if (goalProvided !== true) {
      return;
    }
    for (const label of missingDietProgressTargets(value, input.today)) {
      ctx.addIssue({
        code: "custom",
        message: `Missing the diet progress target for ${label}. Return a "dietProgress" object with "targetWeightKg", "targetBodyFatPercent" and "note".`,
      });
    }
  });
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
        message:
          'Missing the diet goal. Return "diet" with "goal", "goalProvided" and "assessment".',
        path: ["diet"],
      });
      return;
    }
    const goalProvided =
      value.diet.goalProvided ??
      (input.dietGoal == null
        ? undefined
        : (input.dietGoal.goalProvided ??
          !isDefaultDietGoal(input.dietGoal.goal)));
    if (goalProvided === true && value.week.dietProgress == null) {
      ctx.addIssue({
        code: "custom",
        message:
          'Missing the diet progress target for the current week. Return a "dietProgress" object with "targetWeightKg", "targetBodyFatPercent" and "note".',
        path: ["week", "dietProgress"],
      });
    }
  });
}

function weekDateHint(startDate: string): string {
  const dates = weekDates(startDate);
  return `The week must start on ${startDate} and contain exactly seven sessions dated ${dates.join(", ")} (${dates[0]} through ${dates[6]}).`;
}

function dailyDateHint(today: string, startDate: string): string {
  return `The "today" object's date must be exactly ${today}, and week.sessions must contain a session with that exact date. ${weekDateHint(startDate)}`;
}

/**
 * Asks the coach to update any combination of levels in one completion. The
 * prompt receives every current level and the revision request, and returns the
 * complete plan so the API can keep the unchanged levels and apply the ones the
 * request named.
 */
export async function generatePlanUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: PlanUpdateInput,
): Promise<CoachPlan> {
  const weekStart = startOfWeek(input.today);
  const nextWeekStart = input.revision.nextWeek
    ? startOfWeek(addDays(input.today, 1))
    : null;
  const schema = withRequiredDietProgress(
    withWeekDates(withPlausibleCalories(coachPlanSchema), weekStart)
      .refine(
        (value) =>
          nextWeekStart === null ||
          value.nextWeek === null ||
          hasWeekDates(value.nextWeek, nextWeekStart),
        {
          message:
            nextWeekStart === null
              ? "The next week must start on a Monday"
              : `The next week must start on ${nextWeekStart} and contain exactly seven sessions dated ${weekDates(nextWeekStart).join(", ")}`,
          path: ["nextWeek", "sessions"],
        },
      )
      .refine(
        (value) =>
          value.tomorrow === null ||
          value.week.sessions.some(
            (session) => session.date === value.tomorrow?.date,
          ) ||
          value.nextWeek?.sessions.some(
            (session) => session.date === value.tomorrow?.date,
          ) === true,
        {
          message:
            "Tomorrow's session must be one of the current week's or the next week's sessions",
          path: ["tomorrow", "date"],
        },
      ),
    input,
  );
  return completePlanJson(
    schema,
    provider,
    credentials,
    buildPlanUpdateMessages(input),
    PLAN_MAX_TOKENS,
    {
      repairHint: `${dailyDateHint(input.today, weekStart)} Tomorrow is ${addDays(input.today, 1)}; tomorrow's session must be in the current week or the next week${nextWeekStart === null ? "." : `, and the next week must start on ${nextWeekStart}.`} When diet advice is on and no stored goal exists, return "diet" with "goal", "goalProvided" and "assessment". When the athlete stated a diet goal, every current and future period must carry a "dietProgress" object with "targetWeightKg", "targetBodyFatPercent" and "note".`,
      kind: "plan_update",
    },
  );
}

/** Asks the coach for today's session and a revised week. */
export async function generateDailyUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
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
    PLAN_MAX_TOKENS,
    {
      repairHint: `${dailyDateHint(input.today, weekStartDate)} When diet advice is on, return "diet" with "goal", "goalProvided" and "assessment". When the athlete stated a diet goal, the week must carry a "dietProgress" object with "targetWeightKg", "targetBodyFatPercent" and "note".`,
      kind: "daily_update",
    },
  );
}

/** Asks the coach for a new week and a revised block. */
export async function generateWeeklyUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
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
    PLAN_MAX_TOKENS,
    { repairHint: weekDateHint(input.weekStartDate), kind: "weekly_update" },
  );
}
