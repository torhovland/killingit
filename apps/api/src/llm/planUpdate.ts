import {
  coachPlanSchema,
  dailyPlanUpdateSchema,
  weeklyPlanUpdateSchema,
  type CoachPlan,
  type DailyPlanUpdate,
  type WeeklyPlanUpdate,
} from "@killingit/shared";
import type { z } from "zod";
import { addDays, startOfWeek, weekDates } from "../plans/dates.js";
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

export interface PlanUpdateCredentials {
  apiKey: string;
  model: string;
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
  const schema = withWeekDates(coachPlanSchema, weekStart)
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
    );
  return completePlanJson(
    schema,
    provider,
    credentials,
    buildPlanUpdateMessages(input),
    PLAN_MAX_TOKENS,
    {
      repairHint: `${dailyDateHint(input.today, weekStart)} Tomorrow is ${addDays(input.today, 1)}; tomorrow's session must be in the current week or the next week${nextWeekStart === null ? "." : `, and the next week must start on ${nextWeekStart}.`}`,
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
    withWeekDates(dailyPlanUpdateSchema, weekStartDate),
    provider,
    credentials,
    buildDailyUpdateMessages(input),
    PLAN_MAX_TOKENS,
    {
      repairHint: dailyDateHint(input.today, weekStartDate),
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
    withWeekDates(weeklyPlanUpdateSchema, input.weekStartDate),
    provider,
    credentials,
    buildWeeklyUpdateMessages(input),
    PLAN_MAX_TOKENS,
    { repairHint: weekDateHint(input.weekStartDate), kind: "weekly_update" },
  );
}
