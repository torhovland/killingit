import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { athletesRoute } from "./routes/athletes.js";
import { greet } from "./routes/greet.js";
import { health } from "./routes/health.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
  }),
);

const api = new Hono().route("/health", health).route("/greet", greet).route("/athletes", athletesRoute);

app.route("/api", api);

export default {
  port: Number(process.env.PORT ?? 3001),
  hostname: "0.0.0.0",
  fetch: app.fetch,
};

export type AppType = typeof app;