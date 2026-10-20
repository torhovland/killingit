import { z } from "zod";

/** A simple heartbeat response, used for health checks across services. */
export const healthSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type Health = z.infer<typeof healthSchema>;

/** A placeholder greeting payload for the wiring smoke test. */
export const greetingSchema = z.object({
  message: z.string(),
});

export type Greeting = z.infer<typeof greetingSchema>;

export {
  athleteIdentitySchema,
  type AthleteIdentity,
} from "./athleteIdentity.js";

export {
  garminConnectionStatusSchema,
  type GarminConnectionStatus,
} from "./garminConnection.js";

export {
  activitiesResponseSchema,
  activitySampleSchema,
  activitySchema,
  activitySummarySchema,
  type ActivitiesResponse,
  type Activity,
  type ActivitySample,
  type ActivitySummary,
} from "./activity.js";

export {
  analyzedActivitiesResponseSchema,
  analyzedActivitySchema,
  coachAnalysisSchema,
  llmModelSchema,
  llmModelsResponseSchema,
  llmSettingsSchema,
  llmSettingsUpdateSchema,
  type AnalyzedActivitiesResponse,
  type AnalyzedActivity,
  type CoachAnalysis,
  type LlmModel,
  type LlmModelsResponse,
  type LlmSettings,
  type LlmSettingsUpdate,
} from "./llm.js";
