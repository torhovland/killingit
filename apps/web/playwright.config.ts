import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const API_DIR = fileURLToPath(new URL("../api", import.meta.url));
const API_URL = "http://127.0.0.1:3101";
const WEB_URL = "http://127.0.0.1:5174";

/**
 * Playwright configuration for the end-to-end suite (see
 * `docs/specs/e2e-tests.md`). Playwright starts the e2e API process and the
 * e2e Vite server, then runs one Chromium project serially so every journey
 * sees a freshly seeded database.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun run e2e",
      cwd: API_DIR,
      url: `${API_URL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bun run dev:e2e",
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
