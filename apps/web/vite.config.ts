import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const authToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryRelease = process.env.SENTRY_RELEASE;

// Source maps are uploaded to Sentry only when fully configured (auth token +
// org + project), so a local build without SENTRY_AUTH_TOKEN set still works.
// `release` is set so uploaded maps resolve to the same release as runtime
// events (see `instrument.ts`).
const sentryPlugins =
  authToken && sentryOrg && sentryProject
    ? [
        sentryVitePlugin({
          authToken,
          org: sentryOrg,
          project: sentryProject,
          // `release` is an object; `name` sets the release value and
          // `inject: false` avoids injecting Sentry.release into the bundle
          // (we set release ourselves in instrument.ts at runtime).
          ...(sentryRelease
            ? { release: { name: sentryRelease, inject: false } }
            : {}),
          sourcemaps: { filesToDeleteAfterUpload: ["**/*.js.map"] },
        }),
      ]
    : [];

export default defineConfig(({ command }) => {
  // Expose a single, explicit environment flag to the app so features can be
  // enabled in Development and Test but never in Production. The deploy
  // pipeline overrides this for deployed environments; local dev defaults to
  // "Development" and a plain build defaults to "Production".
  process.env.VITE_APP_ENV ??=
    command === "serve" ? "Development" : "Production";

  return {
    plugins: [react(), tailwindcss(), ...sentryPlugins],
    build: {
      sourcemap: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true,
          // LLM analysis batches can take a while; keep the dev proxy from
          // cutting the upstream connection before the API responds.
          timeout: 300_000,
          proxyTimeout: 300_000,
        },
      },
    },
  };
});
