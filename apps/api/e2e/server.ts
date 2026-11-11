import "./config.js";
import { AuthVerificationError } from "../src/auth/provider.js";
import type { AuthProvider } from "../src/auth/provider.js";
import type { startCoachRun } from "../src/coaching/coachRun.js";
import { createApp } from "../src/index.js";
import type { triggerPlanGeneration } from "../src/plans/trigger.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
} from "../testDatabase/database.js";
import {
  E2E_API_PORT,
  E2E_ATHLETE_SUB,
  E2E_AUTH_TOKEN,
  e2eDatabaseUrl,
} from "./config.js";
import { e2eLlmClient } from "./fakeLlm.js";
import { seedE2eState, type SeedOptions } from "./seed.js";

/**
 * The test identity provider. It accepts only the token the browser's fake
 * auth adapter sends; every other token is a normal verification failure.
 */
const e2eAuthProvider: AuthProvider = {
  verify: (token: string) => {
    if (token !== E2E_AUTH_TOKEN) {
      return Promise.reject(new AuthVerificationError("invalid e2e token"));
    }
    return Promise.resolve({ sub: E2E_ATHLETE_SUB });
  },
};

/** Plan generation is covered elsewhere; a journey must not wait for it. */
const noPlanGeneration: typeof triggerPlanGeneration = () =>
  Promise.resolve(true);

/** Comment replies run as a background coach run; the suite replies inline. */
const noCoachRun: typeof startCoachRun = () => Promise.resolve(true);

await prepareTestDatabase(e2eDatabaseUrl);

const app = createApp({
  authProvider: e2eAuthProvider,
  loadLlm: () => Promise.resolve(e2eLlmClient),
  triggerPlanGeneration: noPlanGeneration,
  startCoachRun: noCoachRun,
});

// Test-only reset and seed hook, mounted outside `/api` so it never passes
// through the production auth chain. It exists only in this e2e process.
app.post("/e2e/seed", async (c) => {
  const options = await c.req.json<SeedOptions>();
  return c.json(await seedE2eState(options));
});

const server = Bun.serve({
  port: E2E_API_PORT,
  hostname: "127.0.0.1",
  fetch: app.fetch,
  idleTimeout: 60,
});

console.log(`[e2e] API listening on ${String(server.url)}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server
      .stop()
      .then(() => closeTestDatabase())
      .finally(() => process.exit(0));
  });
}
