/**
 * Auth barrel for the web app. Consumers import from `./auth`, never from the
 * adapter module directly, so a future provider swap (Better Auth, per-user
 * keys, …) changes only the import inside this file, not every consumer.
 */
export { useAuth, type AuthState } from "./auth0.js";
