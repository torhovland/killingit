import { z } from "zod";

/** The largest id a PostgreSQL `serial` column can hold. */
const MAX_SERIAL_ID = 2_147_483_647;

/**
 * A positive integer id in a route path, such as `/api/diet/entries/:id`. The
 * path value arrives as a string, so it is coerced; zero, a negative number, a
 * fraction and a value past the serial range are refused here, before a query
 * can turn them into a database error.
 */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive().max(MAX_SERIAL_ID),
});
