import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { validationFailed } from "./errors.js";

/**
 * The project's `zValidator`: it keeps the library's typed `c.req.valid(...)`
 * but turns a validation failure into the shared API error contract instead of
 * the library's own `{ success, error }` payload.
 */
export function zValidator<
  T extends ZodType,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return honoZValidator(target, schema, (result, c) => {
    if (!result.success) {
      return validationFailed(c, result.error);
    }
  });
}
