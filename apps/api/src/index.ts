import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuthProvider } from "./auth/index.js";
import { requireAuth } from "./auth/middleware.js";
import { withSentry } from "./instrumentation/sentry.js";
import { athletesRoute } from "./routes/athletes.js";
import { greet } from "./routes/greet.js";
import { health } from "./routes/health.js";
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

app.route("/api", api);

export default {
  port: Number(process.env.PORT ?? 3001),
  hostname: "0.0.0.0",
  fetch: app.fetch,
};

export type AppType = typeof app;
