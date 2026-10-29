import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuthProvider } from "./auth/index.js";
import { requireAdmin, requireAuth } from "./auth/middleware.js";
import type { AuthProvider } from "./auth/provider.js";
import { withSentry } from "./instrumentation/sentry.js";
import {
  loadUserActivityTrainingLoads,
  type ActivityFeed,
} from "./coaching/activities.js";
import { estimateManualActivityTss } from "./training/manualTss.js";
import type { loadCachedActivityFeed } from "./coaching/feedCache.js";
import type {
  deleteImportedActivity,
  deleteManualActivity,
} from "./coaching/deletions.js";
import type {
  answerCoachingQuestion,
  replyToCoachingInput,
} from "./coaching/replies.js";
import type { saveActivityReview } from "./coaching/reviews.js";
import type { LlmClient } from "./llm/client.js";
import {
  createActivityComment,
  loadManualActivities,
  loadWeeklyNote,
  saveManualActivity,
  saveWeeklyNote,
  updateActivityComment,
  updateManualActivity,
  type CoachingInputs,
} from "./plans/inputs.js";
import type {
  createPeriodReviewComment,
  loadPeriodReview,
  loadPeriodReviews,
  markPeriodReviewReviewed,
  updatePeriodReviewComment,
} from "./plans/periodReviews.js";
import type {
  loadManualActivityReplies,
  loadWeeklyNoteReply,
} from "./plans/replies.js";
import type {
  PlanTriggerDependencies,
  triggerPlanGeneration,
} from "./plans/trigger.js";
import {
  dbPlanGenerationStore,
  dbPlanStore,
  type PlanGenerationStore,
  type PlanStore,
} from "./plans/store.js";
import {
  dbQuestionAnswerStore,
  type QuestionAnswerStore,
} from "./questions/answers.js";
import { adminQuestionsRoute } from "./routes/adminQuestions.js";
import {
  createAdminLlmCallsRoute,
  type AdminLlmCallsDependencies,
} from "./routes/adminLlmCalls.js";
import { createCalendarRoute } from "./routes/calendar.js";
import { syncAthleteMetrics } from "./coaching/athleteMetrics.js";
import { createCoachingRoute } from "./routes/coaching.js";
import { createFitnessRoute } from "./routes/fitness.js";
import { createGarminRoute } from "./routes/garmin.js";
import { greet } from "./routes/greet.js";
import { health } from "./routes/health.js";
import { createLlmRoute } from "./routes/llm.js";
import { createMeRoute } from "./routes/me.js";
import { createPlanRoute } from "./routes/plan.js";
import { createQuestionsRoute } from "./routes/questions.js";
import { createWeatherRoute } from "./routes/weather.js";
import {
  loadBodyHistoryForUser,
  loadFtpHistoryForUser,
} from "./metrics/store.js";
import { loadFitnessHistory } from "./training/history.js";
import { dbUserStore, type UserStore } from "./users/store.js";
import type { searchLocations } from "./weather/openMeteo.js";

// Load local environment for `bun run dev`. Bun does not auto-load dotenv
// files (unlike Vite/Node --env-file). Anchor at the repo root (three levels
// above this file: src -> api -> apps -> root) and fall back to cwd. In
// CI/production the deploy pipeline injects these vars, and this no-ops when
// no `.env` file is found.
const rootEnv = `${import.meta.dir}/../../../.env`;
try {
  process.loadEnvFile(rootEnv);
} catch {
  try {
    process.loadEnvFile();
  } catch {
    // No `.env` file (tests, CI, Cloud Run) — rely on the injected environment.
  }
}

export interface AppDependencies {
  /** Auth provider, or a lazy getter resolved per request. */
  authProvider?: AuthProvider | (() => AuthProvider);
  /** Account store used for role checks and first-user provisioning. */
  userStore?: UserStore;
  /** Athlete answer storage, injectable for DB-free route tests. */
  answerStore?: QuestionAnswerStore;
  /** Stored coach plan and generation progress, injectable for route tests. */
  planStore?: PlanStore;
  generationStore?: PlanGenerationStore;
  /** Activity/LLM loaders, injectable for DB-free plan route tests. */
  loadActivities?: (userId: number) => Promise<ActivityFeed>;
  loadFtpHistory?: typeof loadFtpHistoryForUser;
  loadBodyHistory?: typeof loadBodyHistoryForUser;
  /** Injectable for route tests; defaults to the coach reading the text. */
  syncAthleteMetrics?: typeof syncAthleteMetrics;
  loadCachedFeed?: typeof loadCachedActivityFeed;
  loadActivityTrainingLoads?: typeof loadUserActivityTrainingLoads;
  loadFitnessHistory?: typeof loadFitnessHistory;
  estimateManualTss?: typeof estimateManualActivityTss;
  loadLlm?: (userId: number) => Promise<LlmClient | null>;
  /** Coaching-input loader, injectable for DB-free route tests. */
  loadCoachingInputs?: (
    userId: number,
    weekStartDate: string,
  ) => Promise<CoachingInputs>;
  /** Coaching-input readers and writers, injectable for DB-free route tests. */
  loadManualActivities?: typeof loadManualActivities;
  loadWeeklyNote?: typeof loadWeeklyNote;
  createActivityComment?: typeof createActivityComment;
  updateActivityComment?: typeof updateActivityComment;
  saveActivityReview?: typeof saveActivityReview;
  loadPeriodReviews?: typeof loadPeriodReviews;
  loadPeriodReview?: typeof loadPeriodReview;
  createPeriodReviewComment?: typeof createPeriodReviewComment;
  updatePeriodReviewComment?: typeof updatePeriodReviewComment;
  markPeriodReviewReviewed?: typeof markPeriodReviewReviewed;
  saveManualActivity?: typeof saveManualActivity;
  saveWeeklyNote?: typeof saveWeeklyNote;
  updateManualActivity?: typeof updateManualActivity;
  deleteImportedActivity?: typeof deleteImportedActivity;
  deleteManualActivity?: typeof deleteManualActivity;
  /** Coach replies and their loaders, injectable for DB-free route tests. */
  loadManualActivityReplies?: typeof loadManualActivityReplies;
  loadWeeklyNoteReply?: typeof loadWeeklyNoteReply;
  replyToCoachingInput?: typeof replyToCoachingInput;
  answerCoachingQuestion?: typeof answerCoachingQuestion;
  /** Plan generation trigger, injectable for DB-free route tests. */
  triggerPlanGeneration?: typeof triggerPlanGeneration;
  /** Address search, injectable for DB-free weather route tests. */
  searchLocations?: typeof searchLocations;
  /** Forecast loader, injectable for DB-free plan generation tests. */
  loadForecast?: PlanTriggerDependencies["loadForecast"];
  /** Prompt log readers, injectable for DB-free admin route tests. */
  adminLlmCalls?: AdminLlmCallsDependencies;
  /** Prompt-log failure marker, injectable for DB-free plan route tests. */
  markPlanPromptsFailed?: PlanTriggerDependencies["markPlanPromptsFailed"];
}

// Authentication is opt-in per route. The provider is created lazily on the
// first protected request so module import stays side-effect-free (mirroring
// how Sentry is a no-op without a DSN). When AUTH0_* env vars are absent,
// protected routes respond 401 rather than crashing at startup.
let cachedAuth: AuthProvider | null = null;

/** Builds the Hono app. Dependencies are injectable so tests stay DB-free. */
export function createApp(deps: AppDependencies = {}): Hono {
  const authProvider =
    deps.authProvider ?? (() => (cachedAuth ??= createAuthProvider()));
  const userStore = deps.userStore ?? dbUserStore;
  const answerStore = deps.answerStore ?? dbQuestionAnswerStore;
  const planStore = deps.planStore ?? dbPlanStore;
  const generationStore = deps.generationStore ?? dbPlanGenerationStore;

  const app = new Hono();

  // Initialize Sentry and enable distributed tracing + error capture first, so
  // every request below is traced and errors are captured. No-op without a DSN.
  withSentry(app);

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
      // File downloads read the server's filename from this header, which a
      // cross-origin browser otherwise hides from JavaScript.
      exposeHeaders: ["Content-Disposition"],
    }),
  );

  const api = new Hono().route("/health", health).route("/greet", greet);

  // /api/me also provisions the account on first sign-in and returns its role.
  api.use("/me/*", requireAuth(authProvider));
  api.route("/me", createMeRoute(userStore));

  // Athlete-facing questionnaire. Answers are scoped to the signed-in account
  // and gate the coaching dashboard until every active question is resolved.
  api.use("/questions/*", requireAuth(authProvider));
  api.route(
    "/questions",
    createQuestionsRoute({ users: userStore, answers: answerStore }),
  );

  // Garmin integration is authenticated and per-user. Credentials are never
  // serialized in responses.
  api.use("/garmin/*", requireAuth(authProvider));
  api.route("/garmin", createGarminRoute({ users: userStore }));

  // LLM provider configuration (API key + model) and model discovery, per
  // account. The key is validated, encrypted at rest, and never serialized back
  // to the client.
  api.use("/llm/*", requireAuth(authProvider));
  api.route("/llm", createLlmRoute({ users: userStore }));

  // Address search for the athlete's home location. The actual forecast is
  // fetched during plan generation, not exposed as a public route.
  api.use("/weather/*", requireAuth(authProvider));
  api.route(
    "/weather",
    createWeatherRoute(
      deps.searchLocations !== undefined
        ? { searchLocations: deps.searchLocations }
        : {},
    ),
  );

  // Coaching reads synced Garmin activities, analyses them with the configured
  // LLM, and returns activity data with cached-or-fresh coach analysis.
  api.use("/coaching/*", requireAuth(authProvider));
  api.route(
    "/coaching",
    createCoachingRoute({
      users: userStore,
      answers: answerStore,
      plans: planStore,
      generations: generationStore,
      ...(deps.loadActivities !== undefined
        ? { loadActivities: deps.loadActivities }
        : {}),
      ...(deps.loadCachedFeed !== undefined
        ? { loadCachedFeed: deps.loadCachedFeed }
        : {}),
      ...(deps.loadActivityTrainingLoads !== undefined
        ? { loadActivityTrainingLoads: deps.loadActivityTrainingLoads }
        : {}),
      ...(deps.estimateManualTss !== undefined
        ? { estimateManualTss: deps.estimateManualTss }
        : {}),
      ...(deps.loadFtpHistory !== undefined
        ? { loadFtpHistory: deps.loadFtpHistory }
        : {}),
      ...(deps.loadLlm !== undefined ? { loadLlm: deps.loadLlm } : {}),
      ...(deps.loadCoachingInputs !== undefined
        ? { loadCoachingInputs: deps.loadCoachingInputs }
        : {}),
      ...(deps.loadManualActivities !== undefined
        ? { loadManualActivities: deps.loadManualActivities }
        : {}),
      ...(deps.loadWeeklyNote !== undefined
        ? { loadWeeklyNote: deps.loadWeeklyNote }
        : {}),
      ...(deps.createActivityComment !== undefined
        ? { createActivityComment: deps.createActivityComment }
        : {}),
      ...(deps.updateActivityComment !== undefined
        ? { updateActivityComment: deps.updateActivityComment }
        : {}),
      ...(deps.saveActivityReview !== undefined
        ? { saveActivityReview: deps.saveActivityReview }
        : {}),
      ...(deps.loadPeriodReviews !== undefined
        ? { loadPeriodReviews: deps.loadPeriodReviews }
        : {}),
      ...(deps.loadPeriodReview !== undefined
        ? { loadPeriodReview: deps.loadPeriodReview }
        : {}),
      ...(deps.createPeriodReviewComment !== undefined
        ? { createPeriodReviewComment: deps.createPeriodReviewComment }
        : {}),
      ...(deps.updatePeriodReviewComment !== undefined
        ? { updatePeriodReviewComment: deps.updatePeriodReviewComment }
        : {}),
      ...(deps.markPeriodReviewReviewed !== undefined
        ? { markPeriodReviewReviewed: deps.markPeriodReviewReviewed }
        : {}),
      ...(deps.saveManualActivity !== undefined
        ? { saveManualActivity: deps.saveManualActivity }
        : {}),
      ...(deps.saveWeeklyNote !== undefined
        ? { saveWeeklyNote: deps.saveWeeklyNote }
        : {}),
      ...(deps.updateManualActivity !== undefined
        ? { updateManualActivity: deps.updateManualActivity }
        : {}),
      ...(deps.deleteImportedActivity !== undefined
        ? { deleteImportedActivity: deps.deleteImportedActivity }
        : {}),
      ...(deps.deleteManualActivity !== undefined
        ? { deleteManualActivity: deps.deleteManualActivity }
        : {}),
      ...(deps.loadManualActivityReplies !== undefined
        ? { loadManualActivityReplies: deps.loadManualActivityReplies }
        : {}),
      ...(deps.loadWeeklyNoteReply !== undefined
        ? { loadWeeklyNoteReply: deps.loadWeeklyNoteReply }
        : {}),
      ...(deps.replyToCoachingInput !== undefined
        ? { replyToCoachingInput: deps.replyToCoachingInput }
        : {}),
      ...(deps.answerCoachingQuestion !== undefined
        ? { answerCoachingQuestion: deps.answerCoachingQuestion }
        : {}),
      ...(deps.triggerPlanGeneration !== undefined
        ? { triggerPlanGeneration: deps.triggerPlanGeneration }
        : {}),
      ...(deps.loadForecast !== undefined
        ? { loadForecast: deps.loadForecast }
        : {}),
    }),
  );

  // The fitness history behind the Fitness page: daily load and the estimated
  // FTP over a window. Read-only; derived from the cached feed and the plan.
  api.use("/fitness/*", requireAuth(authProvider));
  api.route(
    "/fitness",
    createFitnessRoute({
      users: userStore,
      plans: planStore,
      ...(deps.loadCachedFeed !== undefined
        ? { loadCachedFeed: deps.loadCachedFeed }
        : {}),
      ...(deps.loadFitnessHistory !== undefined
        ? { loadHistory: deps.loadFitnessHistory }
        : {}),
    }),
  );

  // The calendar page: activities, manual entries, planned sessions, block
  // starts, and the season end over the range the athlete has data for.
  api.use("/calendar/*", requireAuth(authProvider));
  api.route(
    "/calendar",
    createCalendarRoute({
      users: userStore,
      plans: planStore,
      ...(deps.loadCachedFeed !== undefined
        ? { loadCachedFeed: deps.loadCachedFeed }
        : {}),
      ...(deps.loadManualActivities !== undefined
        ? { loadManualActivities: deps.loadManualActivities }
        : {}),
      ...(deps.loadManualActivityReplies !== undefined
        ? { loadManualActivityReplies: deps.loadManualActivityReplies }
        : {}),
    }),
  );

  // The four-level coach plan and its generation progress. The plan is stored
  // per user and advanced by the daily/weekly/block cascade.
  api.route(
    "/coaching/plan",
    createPlanRoute({
      users: userStore,
      answers: answerStore,
      plans: planStore,
      generations: generationStore,
      ...(deps.loadActivities !== undefined
        ? { loadActivities: deps.loadActivities }
        : {}),
      ...(deps.loadFtpHistory !== undefined
        ? { loadFtpHistory: deps.loadFtpHistory }
        : {}),
      ...(deps.loadBodyHistory !== undefined
        ? { loadBodyHistory: deps.loadBodyHistory }
        : {}),
      ...(deps.syncAthleteMetrics !== undefined
        ? { syncAthleteMetrics: deps.syncAthleteMetrics }
        : {}),
      ...(deps.loadLlm !== undefined ? { loadLlm: deps.loadLlm } : {}),
      ...(deps.loadCoachingInputs !== undefined
        ? { loadCoachingInputs: deps.loadCoachingInputs }
        : {}),
      ...(deps.loadForecast !== undefined
        ? { loadForecast: deps.loadForecast }
        : {}),
      ...(deps.markPlanPromptsFailed !== undefined
        ? { markPlanPromptsFailed: deps.markPlanPromptsFailed }
        : {}),
    }),
  );

  // Admin-only configuration. Only the admin (the first account in the
  // environment) may manage the versioned athlete question set (ADR 0006).
  api.use("/admin/*", requireAuth(authProvider), requireAdmin(userStore));
  api.route("/admin/questions", adminQuestionsRoute);
  api.route("/admin/llm-calls", createAdminLlmCallsRoute(deps.adminLlmCalls));

  app.route("/api", api);
  return app;
}

const app = createApp();

export default {
  port: Number(process.env.PORT ?? 3001),
  hostname: "0.0.0.0",
  // LLM analyses can take longer than Bun's default 10-second idle timeout.
  // Without this, Bun closes the connection mid-request and Vite surfaces it as
  // HTTP 502 even though the analyses continue and are persisted. 255s is the
  // maximum Bun accepts and stays under Cloud Run's 300s request timeout.
  idleTimeout: 255,
  fetch: app.fetch,
};

export type AppType = typeof app;
