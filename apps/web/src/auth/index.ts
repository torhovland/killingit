/**
 * Auth barrel for the web app. Consumers import from `./auth`, never from the
 * adapter module directly, so a future provider swap (Better Auth, per-user
 * keys, …) changes only the import inside this file, not every consumer.
 *
 * The `AuthState` returned by `useAuth` is a stable session object: its
 * identity changes only when the session changes (sign-in state, loading
 * state, or the athlete's profile fields), and its methods keep their identity
 * across renders while always reading the current session. Effects may list
 * `auth` or `auth.getToken` as a dependency instead of narrowing to
 * `auth.isAuthenticated`; `react-hooks/exhaustive-deps` enforces that the list
 * is complete.
 */
export { useAuth, type AuthState } from "./auth0.js";
export { SessionExpiredError } from "./session.js";
