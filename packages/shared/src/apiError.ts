import { z } from "zod";

/**
 * Machine-readable kind of an API failure. A code is stable across releases,
 * while its message may be reworded for the athlete.
 */
export const apiErrorCodeSchema = z.enum([
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "payment_required",
  "too_many_requests",
  "api_version_mismatch",
  "bad_gateway",
  "service_unavailable",
  "internal_error",
  // A third-party connection the athlete can fix. These are never a session
  // failure, so a client must not answer one by renewing its own token.
  "garmin_not_connected",
  "garmin_auth_failed",
  "llm_key_invalid",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * Every failed API response body. `message` is short enough to show as-is;
 * `details` carries structured context such as validation issues.
 */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
