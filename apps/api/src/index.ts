import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuthProvider } from "./auth/index.js";
import { requireAuth } from "./auth/middleware.js";
import { withSentry } from "./instrumentation/sentry.js";
import { adminQuestionsRoute } from "./routes/adminQuestions.js";
import { athletesRoute } from "./routes/athletes.js";
import { coachingRoute } from "./routes/coaching.js";
import { garminRoute } from "./routes/garmin.js";
import { greet } from "./routes/greet.js";
import { health } from "./routes/health.js";
import { llmRoute } from "./routes/llm.js";
import { meRoute } from "./routes/me.js";

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

const app = new Hono();

// Initialize Sentry and enable distributed tracing + error capture first, so
// every request below is traced and errors are captured. No-op without a DSN.
withSentry(app);

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
  }),
);

const api = new Hono()
  .route("/health", health)
  .route("/greet", greet)
  .route("/athletes", athletesRoute);

// Authentication is opt-in per route. The provider is created lazily on the
// first protected request so module import stays side-effect-free (mirroring
// how Sentry is a no-op without a DSN). When AUTH0_* env vars are absent,
// protected routes respond 401 rather than crashing at startup.
let cachedAuth: ReturnType<typeof createAuthProvider> | null = null;
const getAuth = () => (cachedAuth ??= createAuthProvider());

api.use("/me/*", requireAuth(getAuth));
api.route("/me", meRoute);

// Garmin integration is authenticated (credential entry + data sync are
// operator-only). Credentials are never serialized in responses.
api.use("/garmin/*", requireAuth(getAuth));
api.route("/garmin", garminRoute);

// LLM provider configuration (API key + model) and model discovery. The key is
// validated, encrypted at rest, and never serialized back to the client.
api.use("/llm/*", requireAuth(getAuth));
api.route("/llm", llmRoute);

// Coaching reads synced Garmin activities, analyses them with the configured
// LLM, and returns activity data with cached-or-fresh coach analysis.
api.use("/coaching/*", requireAuth(getAuth));
api.route("/coaching", coachingRoute);

// Admin management of the versioned athlete question set. In the current
// single-operator phase any signed-in user is an operator (see ADR 0005).
api.use("/admin/questions/*", requireAuth(getAuth));
api.route("/admin/questions", adminQuestionsRoute);

app.route("/api", api);

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
