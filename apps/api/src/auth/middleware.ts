import type { AthleteIdentity } from "@killingit/shared";
import type { Context, MiddlewareHandler } from "hono";
import { AuthVerificationError } from "./provider.js";
import type { AuthProvider } from "./provider.js";

export const ATHLETE_CONTEXT_KEY = "athlete";

declare module "hono" {
  interface ContextVariableMap {
    [ATHLETE_CONTEXT_KEY]: AthleteIdentity;
  }
}

/**
 * Reads `Authorization: Bearer <token>`, verifies it via the provider, and
 * stores the identity on the context. The provider may be a value or a lazy
 * getter (resolved per-request).
 *
 * Failure handling:
 * - a missing/invalid token -> 401,
 * - {@link AuthVerificationError} (token itself invalid) -> 401,
 * - any other error (infrastructure, e.g. JWKS unreachable, or a missing
 *   provider config) -> logged and returned as 503, so a JWKS outage is not
 *   silently mistaken for "not signed in".
 */
export function requireAuth(
  provider: AuthProvider | (() => AuthProvider),
): MiddlewareHandler {
  const resolve = () =>
    typeof provider === "function" ? provider() : provider;

  return async (c, next) => {
    const header = c.req.header("authorization");
    if (header === undefined || !header.startsWith("Bearer ")) {
      return c.text("Unauthorized", 401);
    }

    const token = header.slice("Bearer ".length).trim();
    if (token === "") {
      return c.text("Unauthorized", 401);
    }

    try {
      const identity = await resolve().verify(token);
      c.set(ATHLETE_CONTEXT_KEY, identity);
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        return c.text("Unauthorized", 401);
      }
      // Infrastructure / configuration failure. Surface it (Sentry + logs)
      // rather than swallowing it as 401.
      console.error("[auth] verification infrastructure failure:", err);
      return c.text("Service Unavailable", 503);
    }

    await next();
  };
}

/** Read the authenticated athlete set by {@link requireAuth}. */
export function getAthlete(c: Context): AthleteIdentity {
  return c.var[ATHLETE_CONTEXT_KEY];
}
