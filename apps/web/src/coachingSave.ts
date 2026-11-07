import { coachingInputSaveResponseSchema } from "@killingit/shared";

/**
 * Validates the `{ message, reply }` body every saved coaching input returns.
 * The pages use it for their own mutations; the feed hook uses it for deletes
 * and acknowledgements.
 */
export function parseCoachingSaveResponse(response: unknown): void {
  const parsed = coachingInputSaveResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("Saving the activity returned an unexpected response", {
      cause: parsed.error,
    });
  }
}
