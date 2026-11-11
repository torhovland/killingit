import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import baseConfig from "./vite.config.ts";

const AUTH_BARREL = fileURLToPath(
  new URL("./src/auth/index.ts", import.meta.url),
);
const FAKE_AUTH = fileURLToPath(new URL("./e2e/e2eAuth.ts", import.meta.url));

/**
 * Replaces the Auth0 adapter with the browser-local fake session. Only the
 * `useAuth` adapter changes: the landing page, dashboard, sign-out and account
 * deletion are the production code paths.
 */
function fakeAuthPlugin(): Plugin {
  return {
    name: "e2e-fake-auth",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        importer === AUTH_BARREL &&
        (source === "./auth0.js" || source === "./auth0")
      ) {
        return FAKE_AUTH;
      }
      return null;
    },
  };
}

/** Vite configuration for the Playwright suite (see `docs/specs/e2e-tests.md`). */
export default defineConfig((env) => {
  const base = baseConfig(env);
  return mergeConfig(base, {
    plugins: [fakeAuthPlugin()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3101",
          changeOrigin: true,
          timeout: 300_000,
          proxyTimeout: 300_000,
        },
      },
    },
  });
});
