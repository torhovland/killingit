import { pageWidthClass, type Page } from "./navigation";

/** What the survey gate decides for the page the URL asks for. */
export type SurveyGate = "page" | "wait" | "survey";

export interface SurveyGateInput {
  /** The page the URL asks for. */
  page: Page;
  /** Whether an unanswered question holds the athlete back; false before load. */
  surveyRequired: boolean;
  /** Whether the signed-in account is the admin. */
  isAdmin: boolean;
  /** Whether the account is signed in but its role has not loaded yet. */
  rolePending: boolean;
}

/**
 * Decides what the app shows while the coaching survey is unanswered. The
 * survey owns every page until it is complete, except the admin's own settings
 * page: the admin is the one who edits the questions that block everyone, so
 * the gate waits for the role rather than bouncing a reload through `/survey`.
 */
export function surveyGate({
  page,
  surveyRequired,
  isAdmin,
  rolePending,
}: SurveyGateInput): SurveyGate {
  if (!surveyRequired) {
    return "page";
  }
  if (page === "admin") {
    if (isAdmin) {
      return "page";
    }
    if (rolePending) {
      return "wait";
    }
  }
  return "survey";
}

/**
 * The content-panel width for what is actually on screen. The gate can replace
 * the page the URL asks for, and the survey renders before the redirect
 * rewrites that URL, so a rejected calendar visit must not widen the survey.
 */
export function panelWidthClass(
  gate: SurveyGate,
  page: Page,
): "max-w-5xl" | "max-w-7xl" {
  return pageWidthClass(gate === "page" ? page : "survey");
}
