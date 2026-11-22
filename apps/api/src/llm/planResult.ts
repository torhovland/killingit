import { z } from "zod";
import {
  blockPlanSchema,
  bodyMetricEstimateSchema,
  coachResponseNotesSchema,
  dayPlanSchema,
  dietPlanSchema,
  seasonPlanSchema,
  weekPlanSchema,
} from "@killingit/shared";
import type { PlanUpdateResponseLevels } from "./planUpdatePrompt.js";

/**
 * The four schemas that parse the coach's structured answers to the plan
 * prompts: a season, a first block, a daily cascade and a weekly build. Only
 * the API parses these, so they live here rather than in the shared package,
 * which keeps the plan DTOs they compose. See ADR 0055.
 */

/**
 * The first step of a full build: the season plan alone. Splitting the build
 * keeps each completion comfortably below the model's output budget.
 */
export const seasonPlanUpdateSchema = z
  .object({
    season: seasonPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape)
  .refine(
    (value) =>
      typeof value.season.introduction === "string" &&
      value.season.introduction.trim() !== "",
    {
      message:
        'The season must open with an "introduction": a short greeting that introduces the coach and welcomes the athlete.',
      path: ["season", "introduction"],
    },
  );

export type SeasonPlanUpdate = z.infer<typeof seasonPlanUpdateSchema>;

/** The second step of a full build: the first block of the season. */
export const initialBlockUpdateSchema = z
  .object({
    block: blockPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type InitialBlockUpdate = z.infer<typeof initialBlockUpdateSchema>;

/**
 * The daily cascade output: today's concrete session plus the remainder of the
 * week revised around it.
 */
export const dailyPlanUpdateSchema = z
  .object({
    today: dayPlanSchema,
    tomorrow: dayPlanSchema.nullable().default(null),
    week: weekPlanSchema,
    diet: dietPlanSchema.optional(),
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape)
  .refine(
    (value) =>
      value.week.sessions.some((session) => session.date === value.today.date),
    {
      message: "Today's session must be one of the week's sessions",
      path: ["today", "date"],
    },
  );

export type DailyPlanUpdate = z.infer<typeof dailyPlanUpdateSchema>;

const planUpdateResponseBaseSchema = z
  .object({
    season: seasonPlanSchema,
    block: blockPlanSchema,
    week: weekPlanSchema,
    today: dayPlanSchema,
    tomorrow: dayPlanSchema.nullable().default(null),
    nextWeek: weekPlanSchema.nullable().default(null),
    nextBlock: blockPlanSchema.nullable().default(null),
    diet: dietPlanSchema.nullable().optional(),
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

/** The weekly build output: the new week plus a revised block plan. */
export const weeklyPlanUpdateSchema = z
  .object({
    week: weekPlanSchema,
    block: blockPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type WeeklyPlanUpdate = z.infer<typeof weeklyPlanUpdateSchema>;

/**
 * The plan-update answer. A revision asks only for the levels it changes, so
 * the levels it omits are optional here and keep their stored content. The
 * levels the revision does return are required. See ADR 0063.
 */
export function planUpdateResponseSchema(levels: PlanUpdateResponseLevels) {
  const optional: {
    [K in keyof typeof planUpdateResponseBaseSchema.shape]?: true;
  } = {};
  if (!levels.season) {
    optional.season = true;
  }
  if (!levels.block) {
    optional.block = true;
  }
  if (!levels.week) {
    optional.week = true;
  }
  if (!levels.today) {
    optional.today = true;
  }
  if (!levels.tomorrow) {
    optional.tomorrow = true;
  }
  if (!levels.nextWeek) {
    optional.nextWeek = true;
  }
  if (!levels.nextBlock) {
    optional.nextBlock = true;
  }
  return planUpdateResponseBaseSchema.partial(optional);
}

export type PlanUpdateResponse = z.infer<
  ReturnType<typeof planUpdateResponseSchema>
>;
