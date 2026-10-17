import { useMemo } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import type { AppState } from "@auth0/auth0-react";

/**
 * Auth0-specific adapter for the web app (ADR 0002 / spec `auth-integration`).
 * All `@auth0/auth0-react` imports live here so the rest of the app depends on
 * a narrow, value-level API rather than the SDK — a future provider swap only
 * touches this module (and the provider wrapper in `main.tsx`).
 */

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign in, returning to the current page afterwards. */
  login(): Promise<void>;
  /** Sign out, returning to the site origin. */
  logout(): Promise<void>;
  /** Resolve a fresh access token for the API, or undefined if signed out. */
  getToken(): Promise<string | undefined>;
}

/**
 * Audience + scopes requested from Auth0. Sharing these between the
 * interactive login and the silent token call ensures the user consents to the
 * API once (interactively), so silent renewal never hits "Consent required".
 */
const API_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE;
const API_SCOPE = "openid profile email read:profile read:workouts";

/** The app's `useAuth` hook (thin wrapper around the Auth0 SDK hook). */
export function useAuth(): AuthState {
  const {
    isAuthenticated,
    isLoading,
    getAccessTokenSilently,
    loginWithRedirect,
    logout,
  } = useAuth0();

  // Memoize so callers get a stable `auth` object (and can safely depend on it
  // in effect/`useMemo` dependency arrays without re-running every render).
  return useMemo(
    () => ({
      isAuthenticated,
      isLoading,
      login: () =>
        loginWithRedirect({
          authorizationParams: {
            ...(API_AUDIENCE ? { audience: API_AUDIENCE } : {}),
            scope: API_SCOPE,
          },
          appState: { returnTo: window.location.pathname } satisfies AppState,
        }),
      logout: () =>
        logout({ logoutParams: { returnTo: window.location.origin } }),
      getToken: async () => {
        if (!isAuthenticated) {
          return undefined;
        }
        return getAccessTokenSilently({
          authorizationParams: {
            ...(API_AUDIENCE ? { audience: API_AUDIENCE } : {}),
            scope: API_SCOPE,
          },
        });
      },
    }),
    [
      isAuthenticated,
      isLoading,
      getAccessTokenSilently,
      loginWithRedirect,
      logout,
    ],
  );
}
