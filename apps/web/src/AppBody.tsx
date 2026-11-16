import type { AthleteQuestionsResponse } from "@killingit/shared";
import type { ReactNode } from "react";
import { CoachingSurveyPage } from "./CoachingSurveyPage";
import { CurrentUserLoadError } from "./CurrentUserProvider";
import { PageOutlet } from "./PageOutlet";
import { PlanGenerationProvider } from "./PlanGenerationProvider";
import { SignInPage } from "./SignInPage";
import { Button } from "./components/Button";
import { cn } from "./components/cn";
import type { Page } from "./navigation";
import { panelWidthClass, type SurveyGate } from "./surveyGate";

interface AppBodyProps {
  /** Whether the athlete is signed in. */
  signedIn: boolean;
  /** Whether the auth session is still loading. */
  authLoading: boolean;
  onSignIn: () => void;
  /** The survey question set, or null before it loads. */
  questions: AthleteQuestionsResponse | null;
  /** Whether the question set is still loading. */
  questionsLoading: boolean;
  /** The failed question load, or null. */
  questionsError: string | null;
  onRetryQuestions: () => void;
  /** What the survey gate decides for the page on screen. */
  gate: SurveyGate;
  /** The page the URL shows. */
  page: Page;
  /** Whether the account is the admin. */
  isAdmin: boolean;
  /** Increment when athlete answers change so the plan refreshes. */
  planRefreshKey: number;
  /** The athlete's saved display zone. */
  timeZone: string | null;
  onAnswersSaved: () => void;
  onTimeZoneChanged: (timeZone: string | null) => void;
}

/**
 * The content panel: the signed-out landing page, the profile and survey
 * states that hold the athlete before their plan, or the page the URL shows,
 * all inside the app-wide plan generation and account load state.
 */
export function AppBody(props: AppBodyProps) {
  const { signedIn, gate, page } = props;
  // The month grid needs room for a wide week box plus seven day columns, so
  // the calendar gets a wider content panel than the other pages. While the
  // survey gate replaces the page, the survey's narrower panel applies.
  const contentWidth = signedIn ? panelWidthClass(gate, page) : "max-w-5xl";

  return (
    <div
      className={cn(
        "mx-auto flex w-full",
        contentWidth,
        "flex-col gap-4 px-0 py-4 sm:px-4 sm:py-6",
      )}
      data-testid="app-panel"
    >
      <PlanGenerationProvider>
        <CurrentUserLoadError />
        {renderBody(props)}
      </PlanGenerationProvider>
    </div>
  );
}

/** The page region for the profile load and the survey gate. */
function renderBody({
  signedIn,
  authLoading,
  onSignIn,
  questions,
  questionsLoading,
  questionsError,
  onRetryQuestions,
  gate,
  page,
  isAdmin,
  planRefreshKey,
  timeZone,
  onAnswersSaved,
  onTimeZoneChanged,
}: AppBodyProps): ReactNode {
  if (!signedIn) {
    return authLoading ? (
      <p className="text-base text-muted-foreground">Loading…</p>
    ) : (
      <SignInPage onSignIn={onSignIn} />
    );
  }
  if (questionsLoading && questions === null) {
    return (
      <p className="text-base text-muted-foreground">Loading your profile…</p>
    );
  }
  if (questions === null) {
    return (
      <section className="flex flex-col items-start gap-2">
        {questionsError && (
          <p className="text-destructive">Error: {questionsError}</p>
        )}
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onRetryQuestions}
        >
          Retry
        </Button>
      </section>
    );
  }
  if (gate === "survey") {
    return <CoachingSurveyPage onAnswersSaved={onAnswersSaved} />;
  }
  if (gate === "wait") {
    // `/admin` renders once the account's role is known, so a reload keeps the
    // admin there instead of bouncing to the survey.
    return <p className="text-base text-muted-foreground">Loading…</p>;
  }
  return (
    <PageOutlet
      page={page === "admin" && !isAdmin ? "coach" : page}
      planRefreshKey={planRefreshKey}
      timeZone={timeZone}
      onSurveyAnswersSaved={onAnswersSaved}
      onTimeZoneChanged={onTimeZoneChanged}
    />
  );
}
