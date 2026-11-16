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

/**
 * A query flag sent as the literal `"true"` or `"false"`. Query values arrive as
 * strings, so the schema checks the only two forms the app sends and coerces an
 * absent flag to false.
 */
export const booleanQuerySchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/** A day boundary or a mutation: the athlete's local date and optional zone. */
export const todayWithTimezoneQuerySchema = todayQuerySchema.extend({
  timezone: timezoneSchema,
});

export type TodayWithTimezoneQuery = z.infer<
  typeof todayWithTimezoneQuerySchema
>;
