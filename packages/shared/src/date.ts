import { z } from "zod";

/** A calendar date in `YYYY-MM-DD` form. */
export const planDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

export type PlanDate = z.infer<typeof planDateSchema>;
