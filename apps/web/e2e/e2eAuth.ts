import { useSyncExternalStore } from "react";
import type { AuthState } from "../src/auth/auth0.js";

/**
 * Browser-local fake session for the Playwright suite. `vite.e2e.config.ts`
 * resolves the web auth adapter to this module, so the landing page, the
 * signed-in dashboard, sign-out and account deletion all run unchanged without
 * contacting Auth0.
 *
 * The session lives in `localStorage` so a reload behaves like a real session
 * and the sign-out journey can clear it. The fixed token is the only token the
 * e2e API process accepts.
 */

const SESSION_KEY = "killingit.e2e.signed-in";
const TOKEN = "e2e-token";
const SUB = "e2e|athlete";
const FIRST_NAME = "E2E";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function isSignedIn(): boolean {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(SESSION_KEY) === "1"
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function signOut(): Promise<void> {
  localStorage.removeItem(SESSION_KEY);
  notify();
  return Promise.resolve();
}

const SIGNED_OUT: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  sub: null,
  firstName: null,
  picture: null,
  login: () => {
    localStorage.setItem(SESSION_KEY, "1");
    notify();
    return Promise.resolve();
  },
  logout: signOut,
  getToken: () => Promise.resolve(undefined),
};

const SIGNED_IN: AuthState = {
  isAuthenticated: true,
  isLoading: false,
  sub: SUB,
  firstName: FIRST_NAME,
  picture: null,
  login: () => Promise.resolve(),
  logout: signOut,
  getToken: () => Promise.resolve(TOKEN),
};

/** The app's `useAuth` hook, backed by the local fake session. */
export function useAuth(): AuthState {
  const signedIn = useSyncExternalStore(subscribe, isSignedIn, () => false);
  return signedIn ? SIGNED_IN : SIGNED_OUT;
}

export type { AuthState };
