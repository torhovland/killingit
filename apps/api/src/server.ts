import { createApp } from "./index.js";

// Load local environment for `bun run dev`. Bun does not auto-load dotenv
// files (unlike Vite/Node --env-file). Anchor at the repo root (three levels
// above this file: src -> api -> apps -> root) and fall back to cwd. In
// CI/production the deploy pipeline injects these vars, and this no-ops when
// no `.env` file is found. This lives in the executable, not in the app
// factory, so importing `createApp` never reads a developer's environment.
function loadLocalEnvironment(): void {
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
}

loadLocalEnvironment();

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
