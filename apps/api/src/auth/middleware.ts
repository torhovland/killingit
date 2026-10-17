import type { AthleteIdentity } from "@killingit/shared";
import type { Context, MiddlewareHandler } from "hono";
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
 * getter (resolved per-request). Returns 401 with no body on failure — never
 * 500 — so callers can distinguish auth failures from server errors.
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
    } catch {
      return c.text("Unauthorized", 401);
    }

    await next();
  };
}

/** Read the authenticated athlete set by {@link requireAuth}. */
export function getAthlete(c: Context): AthleteIdentity {
  return c.var[ATHLETE_CONTEXT_KEY];
}
