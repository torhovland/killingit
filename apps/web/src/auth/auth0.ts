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
  /** The provider's stable user id (`sub`), or null when signed out. */
  sub?: string | null;
  /** The athlete's first name, for the header greeting. */
  firstName?: string | null;
  /** The athlete's profile photo, when the provider has one. */
  picture?: string | null;
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

/** Whether Auth0 is configured for this build (VITE_* set at build time). */
const AUTH0_CONFIGURED =
  Boolean(import.meta.env.VITE_AUTH0_DOMAIN) &&
  Boolean(import.meta.env.VITE_AUTH0_CLIENT_ID);

/** Stable no-op state used when Auth0 is not configured for this build. */
const NOOP_AUTH: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  sub: null,
  firstName: null,
  picture: null,
  login: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  getToken: () => Promise.resolve(undefined),
};

/** The app's `useAuth` hook (thin wrapper around the Auth0 SDK hook). */
export function useAuth(): AuthState {
  // No hooks are needed when Auth0 is disabled; return a stable no-op state
  // without invoking the SDK (whose `useAuth0` throws outside a provider).
  if (!AUTH0_CONFIGURED) {
    return NOOP_AUTH;
  }

  const {
    user,
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
      sub: user?.sub ?? null,
      firstName: resolveFirstName(user),
      picture: user?.picture ?? null,
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
      user?.sub,
      user?.given_name,
      user?.name,
      user?.nickname,
      user?.email,
      user?.picture,
      isAuthenticated,
      isLoading,
      getAccessTokenSilently,
      loginWithRedirect,
      logout,
    ],
  );
}

function resolveFirstName(
  user:
    | { given_name?: string; name?: string; nickname?: string; email?: string }
    | undefined,
): string | null {
  if (!user) {
    return null;
  }
  const given = user.given_name?.trim();
  if (given) {
    return given;
  }
  const fromName = user.name?.trim().split(/\s+/)[0];
  if (fromName) {
    return fromName;
  }
  const nickname = user.nickname?.trim();
  if (nickname) {
    return nickname;
  }
  return user.email?.split("@")[0] ?? null;
}
