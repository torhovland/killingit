import { Auth0Provider } from "./auth0.js";
import type { AuthProvider } from "./provider.js";

/**
 * The auth provider used by the running API. Wired to Auth0 via environment
 * variables (see `.env.example`); a no-op/fake provider is not used here —
 * tests construct their own Auth0Provider with an injected fetch.
 */
export function createAuthProvider(): AuthProvider {
  const issuer = process.env.AUTH0_ISSUER?.trim();
  const audience = process.env.AUTH0_AUDIENCE?.trim();

  if (!issuer || !audience) {
    throw new Error(
      "AUTH0_ISSUER and AUTH0_AUDIENCE must be set to enable authentication",
    );
  }

  return new Auth0Provider({ issuer, audience });
}
