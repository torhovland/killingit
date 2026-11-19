import type { ReactNode } from "react";
import { ActivitiesPage } from "./activities/ActivitiesPage";
import { AdminSettingsPage } from "./admin/AdminSettingsPage";
import { CalendarPage } from "./calendar/CalendarPage";
import { CoachDashboard } from "./coach/CoachDashboard";
import { CoachingSurveyPage } from "./coach/CoachingSurveyPage";
import { CostsPage } from "./costs/CostsPage";
import { DietPage } from "./diet/DietPage";
import { FitnessPage } from "./fitness/FitnessPage";
import { SeasonReviewPage } from "./coach/SeasonReviewPage";
import { SettingsPage } from "./settings/SettingsPage";
import type { Page } from "./navigation";

export interface PageOutletProps {
  /** The page to render. The caller resolves unknown and guarded paths. */
  page: Page;
  /** Increment when athlete answers change so the plan refreshes. */
  planRefreshKey: number;
  /** The athlete's saved display zone; an account setting, not the page's. */
  timeZone: string | null;
  onTimeZoneChanged: (timeZone: string | null) => void;
  onSurveyAnswersSaved: () => void;
}

type PageRenderer = (props: PageOutletProps) => ReactNode;

/**
 * The single map from a page to its component. A new page adds one entry here
 * and one definition in `navigation.tsx`, and the type system then requires
 * both to exist. The current user is not passed down: a page that needs it
 * reads `useCurrentUser` itself.
 */
const PAGE_RENDERERS: Record<Page, PageRenderer> = {
  coach: ({ planRefreshKey }) => (
    <CoachDashboard planRefreshKey={planRefreshKey} />
  ),
  diet: () => <DietPage />,
  fitness: () => <FitnessPage />,
  calendar: () => <CalendarPage />,
  activities: () => <ActivitiesPage />,
  seasonReview: () => <SeasonReviewPage />,
  survey: ({ onSurveyAnswersSaved }) => (
    <CoachingSurveyPage onAnswersSaved={onSurveyAnswersSaved} />
  ),
  costs: () => <CostsPage />,
  settings: ({ timeZone, onTimeZoneChanged }) => (
    <SettingsPage timeZone={timeZone} onTimeZoneChanged={onTimeZoneChanged} />
  ),
  admin: () => <AdminSettingsPage />,
};

/** Renders the top-level page selected by the URL. */
export function PageOutlet(props: PageOutletProps): ReactNode {
  return PAGE_RENDERERS[props.page](props);
}
