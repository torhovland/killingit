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
  currentUserSchema,
  userRoleSchema,
  type CurrentUser,
  type UserRole,
} from "./user.js";

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

export {
  blockPlanSchema,
  blockPlanUpdateSchema,
  blockWeekSummarySchema,
  coachPlanResponseSchema,
  coachPlanSchema,
  dailyPlanUpdateSchema,
  dayPlanSchema,
  initialBlockUpdateSchema,
  planDateSchema,
  planGenerateInputSchema,
  planGenerationStatusSchema,
  planPendingSchema,
  seasonBlockSummarySchema,
  seasonPlanSchema,
  seasonPlanUpdateSchema,
  weekPlanSchema,
  weekSessionSchema,
  weekSessionStatusSchema,
  weeklyPlanUpdateSchema,
  type BlockPlan,
  type BlockPlanUpdate,
  type BlockWeekSummary,
  type CoachPlan,
  type CoachPlanResponse,
  type DailyPlanUpdate,
  type DayPlan,
  type InitialBlockUpdate,
  type PlanGenerateInput,
  type PlanGenerationStatus,
  type PlanPending,
  type SeasonBlockSummary,
  type SeasonPlan,
  type SeasonPlanUpdate,
  type WeekPlan,
  type WeekSession,
  type WeekSessionStatus,
  type WeeklyPlanUpdate,
} from "./plan.js";

export {
  athleteQuestionSchema,
  athleteQuestionsResponseSchema,
  isQuestionnaireComplete,
  QUESTION_ANSWER_MAX_LENGTH,
  questionAnswerInputSchema,
  questionAnswersInputSchema,
  questionArchivedResponseSchema,
  questionInputSchema,
  questionSchema,
  questionsResponseSchema,
  type AthleteQuestion,
  type AthleteQuestionsResponse,
  type Question,
  type QuestionAnswerInput,
  type QuestionAnswersInput,
  type QuestionArchivedResponse,
  type QuestionInput,
  type QuestionsResponse,
} from "./questions.js";
