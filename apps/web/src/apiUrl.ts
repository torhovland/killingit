/**
 * The API origin this build talks to. Empty means same-origin: the Vite dev
 * server proxies `/api` to the API, and production serves both the app and the
 * API from one host. When the app is served from a different host than the
 * API, the build injects an absolute origin from `VITE_API_URL`.
 *
 * This is the only place the value is read. Everything that talks to the API
 * takes a path and resolves it with {@link apiUrl}, so a page or hook can never
 * forget the base URL or disagree about it. See
 * `docs/specs/web-api-base-url.md` and ADR 0044.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Resolves an API path against the configured origin. `baseUrl` is injectable
 * so the join is testable without rebuilding the app for another origin; every
 * production caller uses the build's own origin.
 */
export function apiUrl(path: string, baseUrl: string = API_BASE_URL): string {
  return `${baseUrl}${path}`;
}
