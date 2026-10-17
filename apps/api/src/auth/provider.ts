import type { AthleteIdentity } from "@killingit/shared";

/**
 * Provider-agnostic authentication boundary (ADR 0002). Handlers and
 * middleware depend only on this interface, never on a specific IdP, so a
 * future switch (Better Auth, per-user keys, …) is an adapter swap.
 */
export interface AuthProvider {
  /**
   * Verify a bearer access token and return the authenticated identity.
   *
   * Contract for errors:
   * - Throws {@link AuthVerificationError} when the token itself is invalid
   *   (bad signature, wrong issuer/audience, expired, malformed, …). Callers
   *   map this to 401.
   * - Any other thrown/rejected error is an infrastructure failure (e.g. the
   *   JWKS endpoint is unreachable) and must NOT be treated as 401.
   */
  verify(token: string): Promise<AthleteIdentity>;
}

/**
 * Base class for "the token is invalid" errors. Each provider's verification
 * error extends this so middleware can distinguish auth failures from
 * infrastructure failures without coupling to a specific provider.
 */
export class AuthVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthVerificationError";
  }
}
