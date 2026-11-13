import { useCallback, useMemo } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import type { AppState } from "@auth0/auth0-react";
import { isUnrecoverableSessionError, SessionExpiredError } from "./session.js";

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
  getToken(options?: { forceRefresh?: boolean }): Promise<string | undefined>;
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

/**
 * The app's `useAuth` hook. `AUTH0_CONFIGURED` is fixed at build time, so
 * resolving the implementation once at module load keeps the hook order in a
 * component stable while still letting a build without Auth0 skip the SDK
 * provider entirely (`useAuth0` throws outside it).
 */
export const useAuth: () => AuthState = AUTH0_CONFIGURED
  ? useConfiguredAuth
  : useNoopAuth;

/**
 * `useAuth` without an Auth0 configuration. No hooks are needed, so a build
 * that has no provider still gets the stable no-op session.
 */
function useNoopAuth(): AuthState {
  return NOOP_AUTH;
}

/**
 * `useAuth` backed by the Auth0 SDK.
 *
 * The returned object is referentially stable while the session is unchanged:
 * its fields and the `useCallback`-wrapped methods keep their identity across
 * renders, and the object itself is rebuilt only when the sign-in state,
 * loading state, or athlete profile values change. Its methods read the
 * current session at call time. An effect may therefore depend on `auth` (or
 * on `auth.getToken`) rather than narrowing to `auth.isAuthenticated`, and the
 * `react-hooks/exhaustive-deps` rule's suggestions are safe to apply.
 */
function useConfiguredAuth(): AuthState {
  const {
    user,
    isAuthenticated,
    isLoading,
    getAccessTokenSilently,
    loginWithRedirect,
    logout: logoutFromProvider,
  } = useAuth0();

  const login = useCallback(
    () =>
      loginWithRedirect({
        authorizationParams: {
          ...(API_AUDIENCE ? { audience: API_AUDIENCE } : {}),
          scope: API_SCOPE,
        },
        appState: { returnTo: window.location.pathname } satisfies AppState,
      }),
    [loginWithRedirect],
  );

  const logout = useCallback(
    () =>
      logoutFromProvider({
        logoutParams: { returnTo: window.location.origin },
      }),
    [logoutFromProvider],
  );

  const getToken = useCallback(
    async (options?: {
      forceRefresh?: boolean;
    }): Promise<string | undefined> => {
      if (!isAuthenticated) {
        return undefined;
      }
      try {
        return await getAccessTokenSilently({
          // A 401 means the cached token was rejected. Skip the cache and
          // renew with the refresh token (or the silent iframe fallback).
          ...(options?.forceRefresh ? { cacheMode: "off" as const } : {}),
          authorizationParams: {
            ...(API_AUDIENCE ? { audience: API_AUDIENCE } : {}),
            scope: API_SCOPE,
          },
        });
      } catch (error) {
        if (!isUnrecoverableSessionError(error)) {
          throw error;
        }
        // The cached session can never renew again, so drop it and let the app
        // render the sign-in button instead of retrying a dead session.
        await logoutFromProvider({ openUrl: false });
        throw new SessionExpiredError(error);
      }
    },
    [isAuthenticated, getAccessTokenSilently, logoutFromProvider],
  );

  const sub = user?.sub ?? null;
  const firstName = resolveFirstName(user);
  const picture = user?.picture ?? null;

  return useMemo(
    () => ({
      isAuthenticated,
      isLoading,
      sub,
      firstName,
      picture,
      login,
      logout,
      getToken,
    }),
    [
      isAuthenticated,
      isLoading,
      sub,
      firstName,
      picture,
      login,
      logout,
      getToken,
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
