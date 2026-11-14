import type {
  AnalyzedActivity,
  AthleteEvent,
  AthleteLocation,
  BodyMetricEstimate,
  CoachPlan,
  DailyHealthPoint,
  DailyWeather,
  DietPlan,
  PlanGenerateMode,
  PlanPending,
  ThresholdSummary,
  MetricPoint,
} from "@killingit/shared";
import type { WeatherForecastSet } from "../../weather/forecast.js";
import type { DietPromptContext } from "../../diet/summary.js";
import type {
  ActivityCommentContext,
  ManualActivityContext,
} from "../../llm/activityContext.js";
import type { CalorieTargetPoint } from "../../llm/dietContext.js";
import type { PeriodReviewContext } from "../../llm/planContext.js";
import type {
  AthleteAnswerContext,
  BodyMetricHistory,
  CoachingSurveyAdjustmentContext,
} from "../../llm/profileContext.js";
import type { LlmProvider } from "../../llm/openrouter.js";
import type { ThresholdTimeline } from "../../training/thresholds.js";
import type { CoachQuestionSourceKind } from "../coachQuestions.js";
import type { RevisionChoice } from "../revision.js";
import type { PlanGenerationStore, PlanStore, StoredPlan } from "../store.js";
import type { captureCompletedPeriodReviews } from "../../coaching/periodReviews.js";

export interface PlanGenerationContext {
  answers: readonly AthleteAnswerContext[];
  answersUpdatedAt: Date | null;
  activities: readonly AnalyzedActivity[];
  manualActivities: readonly ManualActivityContext[];
  activityComments: readonly ActivityCommentContext[];
  weeklyNote: string | null;
  /** The Monday of the week the current note belongs to. */
  weeklyNoteWeekStartDate?: string | null;
  /** The coach's reply to the current week's note, when one exists. */
  weeklyNoteReply?: string | null;
  /** When the current week's note was last saved. */
  weeklyNoteUpdatedAt?: Date | null;
  periodReviews?: readonly PeriodReviewContext[];
  /** When the newest week review was generated or its comment answered. */
  weekReviewUpdatedAt?: Date | null;
  /** When the newest block review was generated or its comment answered. */
  blockReviewUpdatedAt?: Date | null;
  coachingInputsUpdatedAt: Date | null;
  /**
   * Newest coaching input whose coach reply asked for a plan change. A missing
   * value falls back to `coachingInputsUpdatedAt`, so older callers keep the
   * previous always-refresh behaviour.
   */
  coachingInputsRefreshUpdatedAt?: Date | null;
  /** Survey answers changed after the stored plan was generated. */
  coachingSurveyAdjustments?: readonly CoachingSurveyAdjustmentContext[];
  /** Newest general coach analysis among the recent activities, if any. */
  activitiesUpdatedAt?: Date | null;
  /**
   * Newest analysis that judged the workout changes the plan. A missing value
   * falls back to `activitiesUpdatedAt`.
   */
  activitiesRefreshUpdatedAt?: Date | null;
  /** Whether the newest week review event asks for a plan refresh. */
  weekReviewNeedsRefresh?: boolean;
  /** Whether the newest block review event asks for a plan refresh. */
  blockReviewNeedsRefresh?: boolean;
  /**
   * The athlete's IANA time zone, so a recorded activity settles the plan on
   * its local day. A missing zone reads as UTC; see
   * `docs/specs/activity-local-date.md`.
   */
  timeZone?: string | null;
  /** The athlete's home location, used to label the forecast in prompts. */
  location?: AthleteLocation | null;
  /** The combined forecast, used by prompts and weather-change checks. */
  forecast?: readonly DailyWeather[] | null;
  /** Both provider forecasts and their combined average, stored on sessions. */
  weatherForecasts?: WeatherForecastSet | null;
  /** Stored FTP history for the prompt, oldest first. */
  ftpHistory?: readonly MetricPoint[] | undefined;
  /** Every threshold measure in effect today, across all sports. */
  thresholds?: readonly ThresholdSummary[] | undefined;
  /** One threshold timeline per sport and measure, for sport-aware TSS. */
  thresholdTimelines?: readonly ThresholdTimeline[] | undefined;
  /** Stored body weight and body-fat points, for the prompt. */
  bodyHistory?: BodyMetricHistory | undefined;
  /** Stored daily sleep, HRV, readiness and related values for the prompt. */
  dailyHealth?: readonly DailyHealthPoint[] | undefined;
  /** The coach's current diet goal and weight-trend assessment. */
  dietGoal?: DietPlan | null;
  /** Whether the athlete has enabled diet advice. */
  dietAdvice?: boolean;
  /** The coach's earlier calorie targets for recent days, newest first. */
  calorieHistory?: readonly CalorieTargetPoint[] | undefined;
  /** Dated goals and events the athlete stated, for every plan prompt. */
  events?: readonly AthleteEvent[] | undefined;
  /** Meals from the last seven days and completed-week summaries. */
  diet?: DietPromptContext | undefined;
  provider: LlmProvider;
  apiKey: string;
  /** Daily model, kept as the default for older callers and tests. */
  model: string;
  /** Season/block model; falls back to `model`. */
  seasonModel?: string;
  /** Week/day model; falls back to `model`. */
  dailyModel?: string;
  /** Cancels this run's provider requests when a newer run starts. */
  signal?: AbortSignal;
}

export interface GeneratePlanInput {
  userId: number;
  /** The run that must still own the generation row before anything is saved. */
  runId: string;
  /** Cancels the run's provider requests when a newer run starts. */
  signal?: AbortSignal;
  today: string;
  timezone?: string;
  /** How an explicit regeneration should treat the stored season. */
  mode?: PlanGenerateMode;
  /** Rebuild every level even when the stored plan is still current. */
  force?: boolean;
  /** The client is after 18:00, so tomorrow's session is wanted. */
  includeTomorrow?: boolean;
  /**
   * Revise the week around a new input. Today's stored session is preserved
   * unless an activity was already recorded today, in which case today's plan
   * is refreshed to add a short completion note to the planned workout.
   */
  keepToday?: boolean;
  /** Stores the coach's FTP estimates from a generated plan, when supplied. */
  recordFtpEstimates?: (plan: CoachPlan) => Promise<void>;
  /** Stores the body-composition points the coach found, when supplied. */
  recordBodyMetrics?: (points: readonly BodyMetricEstimate[]) => Promise<void>;
  /** Stores the clarification question the coach asked, when supplied. */
  recordCoachQuestion?: (input: {
    question: string;
    model: string;
    sourceKind: CoachQuestionSourceKind;
  }) => Promise<void>;
  /** Clears unanswered questions before a new season or season refresh. */
  clearCoachQuestions?: () => Promise<void>;
  /** Clears consumed survey adjustments after a successful season refresh. */
  clearCoachingSurveyAdjustments?: () => Promise<void>;
  /** Injectable for tests; defaults to the database-backed period review writer. */
  capturePeriodReviews?: (
    input: Parameters<typeof captureCompletedPeriodReviews>[0],
  ) => Promise<readonly PeriodReviewContext[] | void>;
  /** Marks prompt-log rows from a generation that ended in failure. */
  markPromptsFailed?: (
    userId: number,
    since: Date,
    error: string,
  ) => Promise<void>;
  plan: StoredPlan | null;
  context: PlanGenerationContext;
  plans: PlanStore;
  generations: PlanGenerationStore;
}

export interface RevisionDecision extends RevisionChoice {
  /** A missing, forced or deliberately new plan builds all four levels. */
  needsFullPlan: boolean;
  /** The levels the stored plan is missing or must revise. */
  pending: PlanPending;
  /**
   * Inputs or analyses arrived after the plan but none asks for a plan change.
   * The run keeps the plan and records their timestamps so they are not read
   * again, applying the local completion and training-load updates.
   */
  acknowledgementNeeded: boolean;
}
