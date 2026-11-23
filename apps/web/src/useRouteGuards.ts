import { useEffect } from "react";
import type { CurrentUser } from "@killingit/shared";
import { hasAuthCallbackParams } from "./auth/callback";
import {
  navigateToPage,
  pageForPath,
  useLocationPath,
  type Page,
} from "./navigation";
import { surveyGate, type SurveyGate } from "./surveyGate";

export interface RouteGuardOptions {
  /** Whether the athlete is signed in. */
  signedIn: boolean;
  /** Whether the auth session is still initialising. */
  authLoading: boolean;
  /** Whether the signed-in account is still loading. */
  loadingUser: boolean;
  /** The signed-in account, or null before it loads. */
  user: CurrentUser | null;
  /** Whether the account is the admin. */
  isAdmin: boolean;
  /** Whether an unanswered question holds the athlete back; false before load. */
  surveyRequired: boolean;
}

/** The page the URL asks for and what the survey gate decides for it. */
export interface RouteGuardState {
  /** The page on screen; an unknown path renders the coach page for one paint. */
  page: Page;
  /** What the survey gate decides for `page`. */
  gate: SurveyGate;
}

/**
 * Resolves the URL to a page, decides the survey gate for it, and keeps the URL
 * canonical. Every redirect replaces the history entry so the back button
 * never bounces between a guard and the page it rejected.
 */
export function useRouteGuards({
  signedIn,
  authLoading,
  loadingUser,
  user,
  isAdmin,
  surveyRequired,
}: RouteGuardOptions): RouteGuardState {
  const pathname = useLocationPath();
  const matchedPage = pageForPath(pathname);
  // An unknown path renders the coach page while the redirect below replaces
  // the URL.
  const page = matchedPage ?? "coach";
  const gate = surveyGate({
    page,
    surveyRequired,
    isAdmin,
    rolePending: signedIn && loadingUser,
  });

  // Every page has a canonical URL. "/" and any unknown path resolve to the
  // coach page, replacing the entry so the back button stays useful. An Auth0
  // redirect carries the sign-in response in the query string and the SDK
  // reads it in its own effect after this one, so the URL must keep it while
  // auth is still initialising. Once auth has settled, a callback the SDK
  // rejected keeps its error params only until this redirect clears them.
  useEffect(() => {
    if (matchedPage === null && !(authLoading && hasAuthCallbackParams())) {
      navigateToPage("coach", { replace: true });
    }
  }, [authLoading, matchedPage]);

  // An added or revised question sends the athlete to the survey so they can
  // see what changed and answer it. The gate keeps the admin settings page.
  useEffect(() => {
    if (gate === "survey") {
      navigateToPage("survey", { replace: true });
    }
  }, [gate]);

  // Admin settings belong to the admin. A member who opens the URL is sent
  // back to the coach page once their role is known.
  useEffect(() => {
    if (signedIn && user !== null && page === "admin" && !isAdmin) {
      navigateToPage("coach", { replace: true });
    }
  }, [signedIn, user, page, isAdmin]);

  return { page, gate };
}
