import { planDateSchema } from "@killingit/shared";
import { z } from "zod";

/**
 * A route's required `today`: the athlete's local date in `YYYY-MM-DD` form.
 * Routes compose it with `.extend(...)` or `.partial()` for any further query
 * field, and validate it through `zValidator("query", ...)`. See
 * `docs/specs/api-query-validation.md`.
 */
export const todayQuerySchema = z.object({
  today: planDateSchema,
});

/**
 * The athlete's IANA time zone. Absent means the caller falls back to the
 * zone stored on the account.
 */
export const timezoneSchema = z.string().min(1).max(100).optional();

/** A day boundary or a mutation: the athlete's local date and optional zone. */
export const todayWithTimezoneQuerySchema = todayQuerySchema.extend({
  timezone: timezoneSchema,
});

export type TodayWithTimezoneQuery = z.infer<
  typeof todayWithTimezoneQuerySchema
>;
