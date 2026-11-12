import type { CurrentUser } from "@killingit/shared";
import type { ReactNode } from "react";
import { ActivitiesPage } from "./ActivitiesPage";
import { AdminSettingsPage } from "./AdminSettingsPage";
import { CalendarPage } from "./CalendarPage";
import { CoachDashboard } from "./CoachDashboard";
import { CoachingSurveyPage } from "./CoachingSurveyPage";
import { CostsPage } from "./CostsPage";
import { DietPage } from "./DietPage";
import { FitnessPage } from "./FitnessPage";
import { SeasonReviewPage } from "./SeasonReviewPage";
import { SettingsPage } from "./SettingsPage";
import type { Page } from "./navigation";

export interface PageOutletProps {
  /** The page to render. The caller resolves unknown and guarded paths. */
  page: Page;
  /** Increment when athlete answers change so the plan refreshes. */
  planRefreshKey: number;
  /** Whether the athlete wants the food log and diet advice. */
  dietAdvice: boolean;
  isAdmin: boolean;
  timeZone: string | null;
  user: CurrentUser | null;
  onSurveyAnswersSaved: () => void;
  onTimeZoneChanged: (timeZone: string | null) => void;
  onLocationChanged: (location: CurrentUser["location"]) => void;
  onDietAdviceChanged: (dietAdvice: boolean) => void;
}

type PageRenderer = (props: PageOutletProps) => ReactNode;

/**
 * The single map from a page to its component. A new page adds one entry here
 * and one definition in `navigation.tsx`, and the type system then requires
 * both to exist.
 */
const PAGE_RENDERERS: Record<Page, PageRenderer> = {
  coach: ({ planRefreshKey, dietAdvice }) => (
    <CoachDashboard planRefreshKey={planRefreshKey} dietAdvice={dietAdvice} />
  ),
  diet: ({ dietAdvice }) => <DietPage dietAdvice={dietAdvice} />,
  fitness: () => <FitnessPage />,
  calendar: () => <CalendarPage />,
  activities: () => <ActivitiesPage />,
  seasonReview: () => <SeasonReviewPage />,
  survey: ({ onSurveyAnswersSaved }) => (
    <CoachingSurveyPage onAnswersSaved={onSurveyAnswersSaved} />
  ),
  costs: () => <CostsPage />,
  settings: ({
    timeZone,
    user,
    dietAdvice,
    isAdmin,
    onTimeZoneChanged,
    onLocationChanged,
    onDietAdviceChanged,
  }) => (
    <SettingsPage
      timeZone={timeZone}
      onTimeZoneChanged={onTimeZoneChanged}
      location={user?.location ?? null}
      onLocationChanged={onLocationChanged}
      dietAdvice={dietAdvice}
      onDietAdviceChanged={onDietAdviceChanged}
      isAdmin={isAdmin}
    />
  ),
  admin: () => <AdminSettingsPage />,
};

/** Renders the top-level page selected by the URL. */
export function PageOutlet(props: PageOutletProps): ReactNode {
  return PAGE_RENDERERS[props.page](props);
}
