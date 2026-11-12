import type { AthleteIdentity } from "@killingit/shared";
import type { Context, MiddlewareHandler } from "hono";
import { forbidden, serviceUnavailable, unauthorized } from "../http/errors.js";
import type { StoredUser, UserStore } from "../users/store.js";
import { AuthVerificationError } from "./provider.js";
import type { AuthProvider } from "./provider.js";

export const ATHLETE_CONTEXT_KEY = "athlete";
export const USER_CONTEXT_KEY = "user";

declare module "hono" {
  interface ContextVariableMap {
    [ATHLETE_CONTEXT_KEY]: AthleteIdentity;
    [USER_CONTEXT_KEY]: StoredUser;
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
      return unauthorized(c);
    }

    const token = header.slice("Bearer ".length).trim();
    if (token === "") {
      return unauthorized(c);
    }

    try {
      const identity = await resolve().verify(token);
      c.set(ATHLETE_CONTEXT_KEY, identity);
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        return unauthorized(c);
      }
      // Infrastructure / configuration failure. Surface it (Sentry + logs)
      // rather than swallowing it as 401.
      console.error("[auth] verification infrastructure failure:", err);
      return serviceUnavailable(c);
    }

    await next();
  };
}

/** Read the authenticated athlete set by {@link requireAuth}. */
export function getAthlete(c: Context): AthleteIdentity {
  return c.var[ATHLETE_CONTEXT_KEY];
}

/**
 * Resolves the account behind the authenticated subject and stores it on the
 * context, where handlers read it with {@link getUser}. Must run after
 * {@link requireAuth}, which is where the subject comes from.
 *
 * Provisioning happens here, once per request, so no handler creates the
 * account itself. The first account in an environment becomes the admin
 * (ADR 0006).
 *
 * A database failure while resolving the account is an infrastructure failure,
 * not a denial: log it and return 503.
 */
export function requireUser(store: UserStore): MiddlewareHandler {
  return async (c, next) => {
    try {
      const user = await store.ensureUser(getAthlete(c).sub);
      c.set(USER_CONTEXT_KEY, user);
    } catch (err) {
      console.error("[auth] failed to resolve the current user:", err);
      return serviceUnavailable(c);
    }

    await next();
  };
}

/** Read the account resolved by {@link requireUser}. */
export function getUser(c: Context): StoredUser {
  return c.var[USER_CONTEXT_KEY];
}

/**
 * Rejects non-admins with 403. Must run after {@link requireUser}, which is
 * where the account comes from.
 */
export function requireAdmin(): MiddlewareHandler {
  return async (c, next) => {
    if (getUser(c).role !== "admin") {
      return forbidden(c);
    }

    await next();
  };
}
