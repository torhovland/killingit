import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuthProvider } from "./auth/index.js";
import { requireAdmin, requireAuth, requireUser } from "./auth/middleware.js";
import type { AuthProvider } from "./auth/provider.js";
import type {
  AppDependencies,
  ResolvedAppDependencies,
} from "./dependencies.js";
import { withSentry } from "./instrumentation/sentry.js";
import { LlmModelChoiceError } from "./llm/client.js";
import { dbPlanGenerationStore, dbPlanStore } from "./plans/store.js";
import { dbQuestionAnswerStore } from "./questions/answers.js";
import { dbCoachingSurveyAdjustmentStore } from "./questions/adjustments.js";
import { adminQuestionsRoute } from "./routes/adminQuestions.js";
import { createAdminLlmCallsRoute } from "./routes/adminLlmCalls.js";
import { createCalendarRoute } from "./routes/calendar.js";
import { createCoachingRoute } from "./routes/coaching/index.js";
import { createDietRoute } from "./routes/diet.js";
import { createFitnessRoute } from "./routes/fitness.js";
import { createGarminRoute } from "./routes/garmin.js";
import { greet } from "./routes/greet.js";
import { health } from "./routes/health.js";
import { createLlmRoute } from "./routes/llm.js";
import { createMeRoute } from "./routes/me.js";
import { createPlanRoute } from "./routes/plan.js";
import { createQuestionsRoute } from "./routes/questions.js";
import { createWeatherRoute } from "./routes/weather.js";
import { dbUserStore } from "./users/store.js";

export type { AppDependencies } from "./dependencies.js";

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

/**
 * The only `/api` routes reachable without a bearer token. Every other request
 * under `/api` is authenticated before it reaches a handler, so adding,
 * moving, or re-mounting a route can never make it public by accident.
 */
const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  "/api/health",
  "/api/greet",
]);

// The provider is created lazily on the first protected request so module
// import stays side-effect-free (mirroring how Sentry is a no-op without a
// DSN). When AUTH0_* env vars are absent, protected routes respond 401 rather
// than crashing at startup.
let cachedAuth: AuthProvider | null = null;

/** Runs `handler` unless the request is one of the allowlisted public paths. */
function unlessPublic(handler: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) =>
    PUBLIC_API_PATHS.has(c.req.path) ? next() : handler(c, next);
}

/** Builds the Hono app. Dependencies are injectable so tests stay DB-free. */
export function createApp(options: AppDependencies = {}): Hono {
  const authProvider =
    options.authProvider ?? (() => (cachedAuth ??= createAuthProvider()));
  // Resolve the account stores once. Everything else stays optional so each
  // route can keep its own production default; the shared context is forwarded
  // whole, which keeps the wiring below a plain list.
  const deps: ResolvedAppDependencies = {
    ...options,
    userStore: options.userStore ?? dbUserStore,
    answerStore: options.answerStore ?? dbQuestionAnswerStore,
    coachingSurveyAdjustments:
      options.coachingSurveyAdjustments ?? dbCoachingSurveyAdjustmentStore,
    planStore: options.planStore ?? dbPlanStore,
    generationStore: options.generationStore ?? dbPlanGenerationStore,
  };

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof LlmModelChoiceError) {
      return c.json({ error: err.message, settingsUrl: "/settings" }, 409);
    }
    console.error("[api] unhandled error:", err);
    return c.text("Internal Server Error", 500);
  });

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

  // Authenticate the whole API by default, then resolve the account behind the
  // token, and allow only the listed paths through without either. This runs
  // before the sub-app routes, so a handler below always has an athlete and a
  // user on the context, whatever its prefix is.
  app.use(
    "/api/*",
    unlessPublic(requireAuth(authProvider)),
    unlessPublic(requireUser(deps.userStore)),
  );

  // /api/me returns the account already resolved by the middleware and owns
  // its own settings updates and deletion.
  api.route("/me", createMeRoute(deps.userStore));

  // Athlete-facing questionnaire. Answers are scoped to the signed-in account
  // and gate the coaching dashboard until every active question is resolved.
  api.route("/questions", createQuestionsRoute({ answers: deps.answerStore }));

  // Garmin integration is authenticated and per-user. Credentials are never
  // serialized in responses.
  api.route("/garmin", createGarminRoute());

  // LLM provider configuration (API key + model) and model discovery, per
  // account. The key is validated, encrypted at rest, and never serialized back
  // to the client.
  api.route("/llm", createLlmRoute());

  // Address search for the athlete's home location. The actual forecast is
  // fetched during plan generation, not exposed as a public route.
  api.route("/weather", createWeatherRoute(deps));

  // Coaching reads synced Garmin activities, analyses them with the configured
  // LLM, and returns activity data with cached-or-fresh coach analysis.
  api.route("/coaching", createCoachingRoute(deps));

  // The fitness history behind the Fitness page: daily load and the estimated
  // FTP over a window. Read-only; derived from the cached feed and the plan.
  api.route("/fitness", createFitnessRoute(deps));

  // The calendar page: activities, manual entries, planned sessions, block
  // starts, and the season end over the range the athlete has data for.
  api.route("/calendar", createCalendarRoute(deps));

  // The diet log: meals the athlete opted in to logging, with the coach's
  // structured analysis and an authenticated photo endpoint.
  api.route("/diet", createDietRoute(deps));

  // The four-level coach plan and its generation progress. The plan is stored
  // per user and advanced by the daily/weekly/block cascade.
  api.route("/coaching/plan", createPlanRoute(deps));

  // Admin-only configuration. Only the admin (the first account in the
  // environment) may manage the versioned athlete question set (ADR 0006).
  api.use("/admin/*", requireAdmin());
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
