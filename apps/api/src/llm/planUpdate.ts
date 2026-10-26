import {
  blockPlanUpdateSchema,
  dailyPlanUpdateSchema,
  targetDayUpdateSchema,
  weeklyPlanUpdateSchema,
  type BlockPlanUpdate,
  type DailyPlanUpdate,
  type TargetDayUpdate,
  type WeeklyPlanUpdate,
} from "@killingit/shared";
import type { z } from "zod";
import { addDays, startOfWeek } from "../plans/dates.js";
import type { LlmProvider } from "./openrouter.js";
import { completePlanJson } from "./planCompletion.js";
import { PLAN_MAX_TOKENS } from "./planBudget.js";
import {
  buildBlockUpdateMessages,
  buildDailyUpdateMessages,
  buildWeeklyUpdateMessages,
  type BlockUpdateInput,
  type DailyUpdateInput,
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

/** The seven calendar dates a Monday-based week must contain. */
function weekDates(startDate: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
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
    { repairHint: dailyDateHint(input.today, weekStartDate) },
  );
}

/**
 * Asks the coach for a specific target day (tomorrow when planning the next
 * period) and its week. The prompt also asks for the day after the target, but
 * that field is not used; ignoring it keeps a malformed optional suggestion
 * from failing the generation.
 */
export async function generateTargetDayUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: DailyUpdateInput,
): Promise<TargetDayUpdate> {
  const weekStartDate = startOfWeek(input.today);
  return completePlanJson(
    withWeekDates(targetDayUpdateSchema, weekStartDate),
    provider,
    credentials,
    buildDailyUpdateMessages(input),
    PLAN_MAX_TOKENS,
    { repairHint: dailyDateHint(input.today, weekStartDate) },
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
    { repairHint: weekDateHint(input.weekStartDate) },
  );
}

/** Asks the coach for the next block and a revised season. */
export async function generateBlockUpdate(
  provider: LlmProvider,
  credentials: PlanUpdateCredentials,
  input: BlockUpdateInput,
): Promise<BlockPlanUpdate> {
  return completePlanJson(
    blockPlanUpdateSchema,
    provider,
    credentials,
    buildBlockUpdateMessages(input),
    PLAN_MAX_TOKENS,
  );
}
