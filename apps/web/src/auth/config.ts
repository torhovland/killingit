import type { Auth0ProviderWithConfigOptions } from "@auth0/auth0-react";

export interface Auth0Config {
  domain?: string | undefined;
  clientId?: string | undefined;
  audience?: string | undefined;
  redirectUri: string;
}

/**
 * Build the `Auth0Provider` props from the build-time environment.
 *
 * Sessions are persisted in `localStorage` and renewed with rotating refresh
 * tokens rather than the SDK's default hidden-iframe flow. Browsers that block
 * third-party cookies (e.g. Brave) cannot complete the iframe request, so a
 * signed-in athlete would otherwise look signed out after every reload. The
 * Auth0 application must allow the `refresh_token` grant.
 *
 * Returns `null` when Auth0 is not configured, so the app can render without a
 * provider (see `main.tsx`).
 */
export function auth0ProviderOptions(
  config: Auth0Config,
): Auth0ProviderWithConfigOptions | null {
  const { domain, clientId, audience, redirectUri } = config;
  if (!domain || !clientId) {
    return null;
  }

  return {
    domain,
    clientId,
    cacheLocation: "localstorage",
    useRefreshTokens: true,
    authorizationParams: {
      redirect_uri: redirectUri,
      ...(audience ? { audience } : {}),
    },
  };
}
