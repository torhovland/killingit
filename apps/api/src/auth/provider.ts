import type { AthleteIdentity } from "@killingit/shared";

/**
 * Provider-agnostic authentication boundary (ADR 0002). Handlers and
 * middleware depend only on this interface, never on a specific IdP, so a
 * future switch (Better Auth, per-user keys, …) is an adapter swap.
 */
export interface AuthProvider {
  /**
   * Verify a bearer access token and return the authenticated identity.
   * Must throw (or reject) on any invalid token; callers treat a rejected
   * promise as an authentication failure (401), never a server error.
   */
  verify(token: string): Promise<AthleteIdentity>;
}
