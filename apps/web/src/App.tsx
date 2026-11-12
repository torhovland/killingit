import { useEffect, useRef, useState } from "react";
import { currentUserSchema, type CurrentUser } from "@killingit/shared";
import { AppStatusProvider, useAppStatus } from "./AppStatus";
import { CoachingSurveyPage } from "./CoachingSurveyPage";
import { useAuth } from "./auth";
import { fetchJsonAuthed, requestParsed } from "./fetchAuthed";
import {
  NavigationProvider,
  PAGES,
  navigateToPage,
  pageForPath,
  pageLabel,
  pageWidthClass,
  useLocationPath,
  type Page,
} from "./navigation";
import { PageOutlet } from "./PageOutlet";
import { PlanGenerationProvider } from "./PlanGenerationProvider";
import { PwaBanners } from "./PwaBanners";
import { usePwa } from "./PwaContext";
import { InstallAppButton } from "./PwaInstall";
import { reportError } from "./reportError";
import { SignInPage } from "./SignInPage";
import { TimeZoneProvider } from "./TimeZoneContext";
import { useAthleteQuestions } from "./useAthleteQuestions";
import { Button } from "./components/Button";

// Absolute API origin for deployed environments (e.g. the Cloud Run URL).
// Empty string keeps relative "/api" for the local Vite dev proxy.
const API_URL = import.meta.env.VITE_API_URL ?? "";

export function App() {
  return (
    <AppStatusProvider>
      <AppShell />
    </AppStatusProvider>
  );
}

function AppShell() {
  const auth = useAuth();
  const pwa = usePwa();
  const { status, setStatus } = useAppStatus();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const timeZoneTouched = useRef(false);
  const pathname = useLocationPath();
  const matchedPage = pageForPath(pathname);
  // An unknown path renders the coach page while the redirect below replaces
  // the URL.
  const page = matchedPage ?? "coach";
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const {
    questions,
    loading: loadingQuestions,
    error: questionsError,
    load: loadQuestions,
  } = useAthleteQuestions();

  const signedIn = auth.isAuthenticated;
  const isAdmin = me?.role === "admin";

  useEffect(() => {
    const loading = auth.isLoading || (loadingQuestions && questions === null);
    setStatus("app", loading ? "loading" : null);
    return () => setStatus("app", null);
  }, [auth.isLoading, loadingQuestions, questions, setStatus]);

  // Every page has a canonical URL. "/" and any unknown path resolve to the
  // coach page, replacing the entry so the back button stays useful.
  useEffect(() => {
    if (matchedPage === null) {
      navigateToPage("coach", { replace: true });
    }
  }, [matchedPage]);

  // An added or revised question sends the athlete to the survey so they can
  // see what changed and answer it.
  useEffect(() => {
    if (questions !== null && !questions.complete && page !== "survey") {
      navigateToPage("survey", { replace: true });
    }
  }, [page, questions]);

  // Admin settings belong to the admin. A member who opens the URL is sent
  // back to the coach page once their role is known.
  useEffect(() => {
    if (signedIn && me !== null && page === "admin" && !isAdmin) {
      navigateToPage("coach", { replace: true });
    }
  }, [signedIn, me, page, isAdmin]);

  // A page visit asks the API to refresh OpenRouter's catalog. The API checks
  // its own 24-hour timestamp, so this is cheap on every other visit.
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    void fetchJsonAuthed<unknown>(`${API_URL}/api/llm/models/refresh`, auth, {
      method: "POST",
    }).catch(() => {
      // A catalog refresh must never block the page.
    });
  }, [auth.isAuthenticated]);

  // When authenticated, fetch the protected /api/me to prove the token flows.
  useEffect(() => {
    if (!auth.isAuthenticated) {
      setMe(null);
      setTimeZone(null);
      timeZoneTouched.current = false;
      return;
    }
    requestParsed(
      `${API_URL}/api/me`,
      auth,
      currentUserSchema,
      "Loading the current user",
    )
      .then((user) => {
        setMe(user);
        if (!timeZoneTouched.current) {
          setTimeZone(user.timezone);
        }
      })
      .catch((e: unknown) => {
        setError(reportError(e));
      });
    // Depend only on `auth.isAuthenticated`: `useAuth` memoizes `auth`, but the
    // underlying SDK callbacks aren't guaranteed stable.
  }, [auth.isAuthenticated]);

  function navigate(next: Page): void {
    navigateToPage(next);
    setError(null);
  }

  function handleAnswersSaved(): void {
    setPlanRefreshKey((key) => key + 1);
    void loadQuestions();
  }

  // The month grid needs room for a wide week box plus seven day columns, so
  // the calendar gets a wider content panel than the other pages.
  const contentWidth = signedIn ? pageWidthClass(page) : "max-w-5xl";

  return (
    <TimeZoneProvider timeZone={timeZone}>
      <NavigationProvider navigate={navigate}>
        <div className="flex min-h-screen w-full flex-col">
          <header className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href="/coach"
                className="flex items-center gap-2 text-2xl font-bold tracking-tight no-underline hover:no-underline"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("coach");
                }}
              >
                <img
                  src="/logo.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 shrink-0"
                />
                <span className="whitespace-nowrap">Killing It</span>
              </a>
              <span
                aria-hidden="true"
                className="hidden h-5 w-px bg-muted-foreground/45 sm:block"
              />
              <p className="hidden text-sm text-muted-foreground sm:block">
                <b className="font-medium text-primary">Deadly serious</b> about
                your progress
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <InstallAppButton
                installable={pwa.installable}
                onInstall={() => void pwa.install()}
              />
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
                <p className="text-base text-muted-foreground">Loading…</p>
              ) : null}
            </div>
          </header>

          <PwaBanners
            offline={pwa.offline}
            updateReady={pwa.updateReady}
            onReload={() => pwa.reloadForUpdate()}
          />

          <div
            className={`mx-auto flex w-full ${contentWidth} flex-col gap-4 px-0 py-4 sm:px-4 sm:py-6`}
          >
            <PlanGenerationProvider>
              {error && <p className="text-destructive">Error: {error}</p>}

              {!signedIn ? (
                auth.isLoading ? (
                  <p className="text-base text-muted-foreground">Loading…</p>
                ) : (
                  <SignInPage onSignIn={() => void auth.login()} />
                )
              ) : loadingQuestions && questions === null ? (
                <p className="text-base text-muted-foreground">
                  Loading your profile…
                </p>
              ) : questions === null ? (
                <section className="flex flex-col items-start gap-2">
                  {questionsError && (
                    <p className="text-destructive">Error: {questionsError}</p>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => void loadQuestions()}
                  >
                    Retry
                  </Button>
                </section>
              ) : !questions.complete ? (
                <CoachingSurveyPage onAnswersSaved={handleAnswersSaved} />
              ) : (
                <PageOutlet
                  page={page === "admin" && !isAdmin ? "coach" : page}
                  planRefreshKey={planRefreshKey}
                  dietAdvice={me?.dietAdvice ?? false}
                  isAdmin={isAdmin}
                  timeZone={timeZone}
                  user={me}
                  onSurveyAnswersSaved={handleAnswersSaved}
                  onTimeZoneChanged={(timezone) => {
                    timeZoneTouched.current = true;
                    setTimeZone(timezone);
                  }}
                  onLocationChanged={(location) => {
                    setMe((current) =>
                      current === null ? current : { ...current, location },
                    );
                  }}
                  onDietAdviceChanged={(dietAdvice) => {
                    setMe((current) =>
                      current === null ? current : { ...current, dietAdvice },
                    );
                  }}
                />
              )}
            </PlanGenerationProvider>
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
        className="flex cursor-pointer list-none items-center gap-2 rounded border bg-card px-2 py-1.5 text-base hover:bg-muted [&::-webkit-details-marker]:hidden"
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
          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden font-medium sm:inline">{name}</span>
        {isAdmin && (
          <span className="hidden rounded border border-transparent bg-accent px-2 py-0.5 text-sm text-accent-foreground sm:inline">
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
        className="absolute right-0 z-10 mt-1 flex min-w-48 flex-col rounded border bg-card p-1 text-base shadow-lg"
        aria-label="Account"
      >
        {PAGES.filter((entry) => entry !== "admin" || isAdmin).map((entry) => (
          <Button
            key={entry}
            type="button"
            variant="ghost"
            size="menu"
            onClick={(event) => choose(entry, event)}
          >
            {pageLabel(entry)}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="menu"
          className="text-destructive"
          onClick={signOut}
        >
          Sign out
        </Button>
      </nav>
    </details>
  );
}

function closeMenu(event: React.MouseEvent<HTMLButtonElement>): void {
  event.currentTarget.closest("details")?.removeAttribute("open");
}
