import { useEffect, useRef, useState } from "react";
import { currentUserSchema, type CurrentUser } from "@killingit/shared";
import { ActivitiesPage } from "./ActivitiesPage";
import { AdminSettingsPage } from "./AdminSettingsPage";
import { AppStatusProvider, useAppStatus } from "./AppStatus";
import { CoachDashboard } from "./CoachDashboard";
import { CoachingSurveyPage } from "./CoachingSurveyPage";
import { useAuth } from "./auth";
import { AthleteQuestionsForm } from "./AthleteQuestionsForm";
import { fetchJsonAuthed } from "./fetchAuthed";
import { FitnessPage } from "./FitnessPage";
import { NavigationProvider, type Page } from "./navigation";
import { reportError } from "./reportError";
import { SeasonReviewPage } from "./SeasonReviewPage";
import { SettingsPage } from "./SettingsPage";
import { TimeZoneProvider } from "./TimeZoneContext";
import { useAthleteQuestions } from "./useAthleteQuestions";

// Absolute API origin for deployed environments (e.g. the Cloud Run URL).
// Empty string keeps relative "/api" for the local Vite dev proxy.
const API_URL = import.meta.env.VITE_API_URL ?? "";

const PAGE_LABELS: Record<Page, string> = {
  coach: "Coach",
  fitness: "Fitness",
  activities: "Activities",
  seasonReview: "Season review",
  survey: "Coaching survey",
  settings: "Settings",
  admin: "Admin settings",
};

export function App() {
  return (
    <AppStatusProvider>
      <AppShell />
    </AppStatusProvider>
  );
}

function AppShell() {
  const auth = useAuth();
  const { status, setStatus } = useAppStatus();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const timeZoneTouched = useRef(false);
  const [page, setPage] = useState<Page>("coach");
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const {
    questions,
    loading: loadingQuestions,
    error: questionsError,
    load: loadQuestions,
    saveAnswers,
  } = useAthleteQuestions();

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    const loading = auth.isLoading || (loadingQuestions && questions === null);
    setStatus("app", loading ? "loading" : null);
    return () => setStatus("app", null);
  }, [auth.isLoading, loadingQuestions, questions, setStatus]);

  // When authenticated, fetch the protected /api/me to prove the token flows.
  useEffect(() => {
    if (!auth.isAuthenticated) {
      setMe(null);
      setTimeZone(null);
      timeZoneTouched.current = false;
      return;
    }
    fetchJsonAuthed<unknown>(`${API_URL}/api/me`, auth)
      .then((response) => {
        const parsed = currentUserSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(
            "Loading the current user returned an unexpected response",
            { cause: parsed.error },
          );
        }
        setMe(parsed.data);
        if (!timeZoneTouched.current) {
          setTimeZone(parsed.data.timezone);
        }
      })
      .catch((e: unknown) => {
        setError(reportError(e));
      });
    // Depend only on `auth.isAuthenticated`: `useAuth` memoizes `auth`, but the
    // underlying SDK callbacks aren't guaranteed stable.
  }, [auth.isAuthenticated]);

  function navigate(next: Page): void {
    setPage(next);
    setError(null);
  }

  async function handleAnswersSaved(
    answers: Parameters<typeof saveAnswers>[0],
  ): Promise<void> {
    await saveAnswers(answers);
    setPlanRefreshKey((key) => key + 1);
  }

  const signedIn = auth.isAuthenticated;

  return (
    <TimeZoneProvider timeZone={timeZone}>
      <NavigationProvider navigate={navigate}>
        <div className="flex min-h-screen w-full flex-col">
          <header className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 sm:px-4">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <a
                href="/"
                className="text-xl font-bold text-primary no-underline hover:no-underline"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("coach");
                }}
              >
                Killing It
              </a>
              <p className="text-sm text-muted-foreground">
                Deadly serious about your progress
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {signedIn ? (
                <UserMenu
                  firstName={auth.firstName}
                  picture={auth.picture}
                  isAdmin={isAdmin}
                  status={status}
                  onNavigate={navigate}
                  onSignOut={() => void auth.logout()}
                />
              ) : auth.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : null}
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-0 py-4 sm:px-4 sm:py-6">
            {error && <p className="text-destructive">Error: {error}</p>}

            {!signedIn ? (
              auth.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <button
                  className="self-start rounded border border-transparent bg-primary px-4 py-2 text-primary-foreground enabled:hover:bg-primary-hover"
                  onClick={() => void auth.login()}
                >
                  Sign in
                </button>
              )
            ) : loadingQuestions && questions === null ? (
              <p className="text-sm text-muted-foreground">
                Loading your profile…
              </p>
            ) : questions === null ? (
              <section className="flex flex-col items-start gap-2">
                {questionsError && (
                  <p className="text-destructive">Error: {questionsError}</p>
                )}
                <button
                  type="button"
                  className="rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
                  onClick={() => void loadQuestions()}
                >
                  Retry
                </button>
              </section>
            ) : !questions.complete ? (
              <AthleteQuestionsForm
                questions={questions.questions}
                onSubmit={handleAnswersSaved}
              />
            ) : page === "fitness" ? (
              <FitnessPage />
            ) : page === "activities" ? (
              <ActivitiesPage />
            ) : page === "seasonReview" ? (
              <SeasonReviewPage />
            ) : page === "survey" ? (
              <CoachingSurveyPage
                onAnswersSaved={() => setPlanRefreshKey((key) => key + 1)}
              />
            ) : page === "settings" ? (
              <SettingsPage
                timeZone={timeZone}
                onTimeZoneChanged={(timezone) => {
                  timeZoneTouched.current = true;
                  setTimeZone(timezone);
                }}
                location={me?.location ?? null}
                onLocationChanged={(location) => {
                  setMe((current) =>
                    current === null ? current : { ...current, location },
                  );
                }}
              />
            ) : page === "admin" && isAdmin ? (
              <AdminSettingsPage />
            ) : (
              <CoachDashboard planRefreshKey={planRefreshKey} />
            )}
          </div>
        </div>
      </NavigationProvider>
    </TimeZoneProvider>
  );
}

function UserMenu({
  firstName,
  picture,
  isAdmin,
  status,
  onNavigate,
  onSignOut,
}: {
  firstName?: string | null | undefined;
  picture?: string | null | undefined;
  isAdmin: boolean;
  status: "idle" | "loading" | "syncing" | "thinking";
  onNavigate: (page: Page) => void;
  onSignOut: () => void;
}) {
  const name = firstName?.trim() || "Athlete";
  const label =
    status === "thinking"
      ? "The coach is thinking"
      : status === "syncing"
        ? "Syncing"
        : status === "loading"
          ? "Loading"
          : null;

  function choose(page: Page, event: React.MouseEvent<HTMLButtonElement>) {
    closeMenu(event);
    onNavigate(page);
  }

  function signOut(event: React.MouseEvent<HTMLButtonElement>) {
    closeMenu(event);
    onSignOut();
  }

  return (
    <details className="relative" data-testid="user-menu">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded border bg-card px-2 py-1.5 text-sm hover:bg-muted [&::-webkit-details-marker]:hidden"
        aria-label="Open account menu"
        title="Menu"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        {picture ? (
          <img
            src={picture}
            alt=""
            className="size-7 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="font-medium">{name}</span>
        {isAdmin && (
          <span className="rounded border border-transparent bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            Admin
          </span>
        )}
        {label && (
          <span
            className="inline-flex size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            role="status"
            aria-label={label}
            title={label}
            data-testid="header-spinner"
            data-state={status}
          />
        )}
      </summary>
      <nav
        className="absolute right-0 z-10 mt-1 flex min-w-48 flex-col rounded border bg-card p-1 text-sm shadow-lg"
        aria-label="Account"
      >
        {(
          [
            "coach",
            "fitness",
            "activities",
            "seasonReview",
            "survey",
            "settings",
          ] as const
        ).map((entry) => (
          <button
            key={entry}
            type="button"
            className="rounded px-3 py-1.5 text-left hover:bg-muted"
            onClick={(event) => choose(entry, event)}
          >
            {PAGE_LABELS[entry]}
          </button>
        ))}
        {isAdmin && (
          <button
            type="button"
            className="rounded px-3 py-1.5 text-left hover:bg-muted"
            onClick={(event) => choose("admin", event)}
          >
            {PAGE_LABELS.admin}
          </button>
        )}
        <button
          type="button"
          className="rounded px-3 py-1.5 text-left text-destructive hover:bg-muted"
          onClick={signOut}
        >
          Sign out
        </button>
      </nav>
    </details>
  );
}

function closeMenu(event: React.MouseEvent<HTMLButtonElement>): void {
  event.currentTarget.closest("details")?.removeAttribute("open");
}
