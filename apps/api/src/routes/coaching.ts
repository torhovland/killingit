import { analyzedActivitiesResponseSchema } from "@killingit/shared";
import { Hono } from "hono";
import { z } from "zod";
import {
  DEFAULT_ACTIVITIES,
  GarminCredentialsError,
  GarminNotConnectedError,
  LlmCredentialsError,
  loadAnalyzedActivities,
  MAX_ACTIVITIES,
} from "../coaching/activities.js";
import { GarminAuthError, GarminSidecarError } from "../garmin/client.js";
import { LlmAuthError, LlmProviderError } from "../llm/openrouter.js";

const querySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ACTIVITIES)
    .default(DEFAULT_ACTIVITIES),
  refresh: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

/**
 * Coaching routes (ADR 0004). Syncs the operator's Garmin activities, analyses
 * the most recent ones with the configured LLM, and returns activity data plus
 * cached-or-fresh coach analysis. One failed analysis does not fail the batch.
 */
export const coachingRoute = new Hono().get("/activities", async (c) => {
  const query = querySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.text("Invalid query parameters", 400);
  }

  try {
    const feed = await loadAnalyzedActivities({
      limit: query.data.limit,
      refresh: query.data.refresh,
    });
    return c.json(analyzedActivitiesResponseSchema.parse(feed));
  } catch (err) {
    if (err instanceof GarminNotConnectedError) {
      return c.text(err.message, 401);
    }
    if (err instanceof GarminAuthError) {
      return c.text(err.message, 401);
    }
    if (err instanceof GarminSidecarError && err.status) {
      c.status(err.status as 401 | 403 | 429 | 502);
      return c.text(err.message);
    }
    if (
      err instanceof GarminCredentialsError ||
      err instanceof LlmCredentialsError
    ) {
      console.error(`[coaching] ${err.message}`);
      return c.text(err.message, 503);
    }
    if (err instanceof LlmAuthError) {
      return c.text(err.message, 401);
    }
    if (err instanceof LlmProviderError) {
      return c.text(err.message, 503);
    }
    console.error("[coaching] activity feed failure:", err);
    return c.text("Service Unavailable", 503);
  }
});
