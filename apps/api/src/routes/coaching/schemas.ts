import { planDateSchema } from "@killingit/shared";
import { z } from "zod";

/** A mutation that needs the athlete's local date and timezone. */
export const deletionQuerySchema = z.object({
  today: planDateSchema,
  timezone: z.string().min(1).max(100).optional(),
});
