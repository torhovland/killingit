import type { AthleteIdentity } from "@killingit/shared";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { AuthProvider } from "./provider.js";

export interface Auth0Config {
  /** e.g. "https://dev-xxxx.us.auth0.com/" — trailing slash required. */
  issuer: string;
  /** The API audience (`aud` claim) the token must carry. */
  audience: string;
}

/** Fetch signature accepted by jose's remote JWKS resolver. */
type FetchFn = (
  input: string,
  init?: {
    headers: Headers;
    method: "GET";
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<Response>;

/**
 * Auth0-backed AuthProvider: verifies RS256 access tokens against the
 * tenant's JWKS and checks issuer/audience/expiry. The JWKS `fetch` is
 * injectable so tests never touch the network; the default is global `fetch`.
 */
export class Auth0Provider implements AuthProvider {
  private readonly config: Auth0Config;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: Auth0Config, fetchFn: FetchFn = defaultFetchFn) {
    this.config = { issuer: config.issuer, audience: config.audience };
    this.jwks = createRemoteJWKSet(new URL(jwksUrl(config.issuer)), {
      [customFetch]: fetchFn,
    });
  }

  async verify(token: string): Promise<AthleteIdentity> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.audience,
    });

    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new Auth0VerificationError("token missing sub claim");
    }

    return { sub: payload.sub };
  }
}

/** Thrown when a token is invalid in any way. Distinct from network/server errors. */
export class Auth0VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Auth0VerificationError";
  }
}

/** Auth0's JWKS endpoint for a given issuer. */
export function jwksUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
}

/** Default fetch: the global fetch, narrowed to the jose-compatible shape. */
const defaultFetchFn: FetchFn = (input, init) => globalThis.fetch(input, init);
