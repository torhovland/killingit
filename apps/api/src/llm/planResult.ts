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

/** The weekly build output: the new week plus a revised block plan. */
export const weeklyPlanUpdateSchema = z
  .object({
    week: weekPlanSchema,
    block: blockPlanSchema,
    bodyMetrics: z.array(bodyMetricEstimateSchema).default([]),
  })
  .extend(coachResponseNotesSchema.shape);

export type WeeklyPlanUpdate = z.infer<typeof weeklyPlanUpdateSchema>;
