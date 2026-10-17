import type { AthleteIdentity } from "@killingit/shared";
import { createRemoteJWKSet, customFetch, errors, jwtVerify } from "jose";
import type { FetchImplementation } from "jose";
import { AuthVerificationError } from "./provider.js";
import type { AuthProvider } from "./provider.js";

export interface Auth0Config {
  /** e.g. "https://dev-xxxx.us.auth0.com/" — trailing slash required. */
  issuer: string;
  /** The API audience (`aud` claim) the token must carry. */
  audience: string;
}

/**
 * Auth0-backed AuthProvider: verifies RS256 access tokens against the
 * tenant's JWKS and checks issuer/audience/expiry. The JWKS `fetch` is
 * injectable so tests never touch the network; the default is global `fetch`.
 */
export class Auth0Provider implements AuthProvider {
  private readonly config: Auth0Config;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    config: Auth0Config,
    fetchFn: FetchImplementation = defaultFetchFn,
  ) {
    this.config = { issuer: config.issuer, audience: config.audience };
    this.jwks = createRemoteJWKSet(new URL(jwksUrl(config.issuer)), {
      [customFetch]: fetchFn,
    });
  }

  async verify(token: string): Promise<AthleteIdentity> {
    let payload: { sub?: unknown };
    try {
      ({ payload } = await jwtVerify<{ sub?: unknown }>(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      }));
    } catch (cause) {
      // jose throws JOSEError for token-level failures (bad signature, wrong
      // iss/aud, expired, malformed); wrap those as a verification error (the
      // caller maps it to 401). A JWKS *fetch/network* failure rejects with a
      // non-JOSEError, which we deliberately let propagate as infrastructure.
      if (cause instanceof errors.JOSEError) {
        throw new AuthVerificationError("invalid token", { cause });
      }
      throw cause;
    }

    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new AuthVerificationError("token missing sub claim");
    }

    return { sub: payload.sub };
  }
}

/**
 * Auth0's "invalid token" error. Extends the provider-agnostic
 * {@link AuthVerificationError} so middleware can map it to 401 without
 * importing this module.
 */
export class Auth0VerificationError extends AuthVerificationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "Auth0VerificationError";
  }
}

/** Auth0's JWKS endpoint for a given issuer. */
export function jwksUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
}

/** Default fetch: the global fetch, narrowed to the jose-compatible shape. */
const defaultFetchFn: FetchImplementation = (input, init) =>
  globalThis.fetch(input, init);
