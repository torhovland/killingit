import { useEffect, useState } from "react";
import {
  AthleteQuestionsProvider,
  useAthleteQuestionsContext,
} from "./AthleteQuestionsProvider";
import { AppBody } from "./AppBody";
import { AppHeader } from "./AppHeader";
import { AppStatusProvider, useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { CurrentUserProvider, useCurrentUser } from "./CurrentUserProvider";
import { fetchJsonAuthed } from "./fetchAuthed";
import { NavigationProvider, navigateToPage } from "./navigation";
import { PwaBanners } from "./PwaBanners";
import { usePwa } from "./PwaContext";
import { TimeZoneProvider } from "./TimeZoneContext";
import { useRouteGuards } from "./useRouteGuards";
import { useTimeZoneState } from "./useTimeZoneState";

export function App() {
  return (
    <AppStatusProvider>
      <CurrentUserProvider>
        <AthleteQuestionsProvider>
          <AppShell />
        </AthleteQuestionsProvider>
      </CurrentUserProvider>
    </AppStatusProvider>
  );
}

function AppShell() {
  const auth = useAuth();
  const pwa = usePwa();
  const { status, setStatus } = useAppStatus();
  const { user, loading: loadingUser } = useCurrentUser();
  const {
    questions,
    loading: loadingQuestions,
    error: questionsError,
    load: loadQuestions,
  } = useAthleteQuestionsContext();
  const [planRefreshKey, setPlanRefreshKey] = useState(0);

  const signedIn = auth.isAuthenticated;
  const isAdmin = user?.role === "admin";
  // The coaching survey holds the athlete back until it is answered; only the
  // admin's own settings page stays open, because the admin edits the
  // questions that block everyone.
  const surveyRequired = questions !== null && !questions.complete;
  const { page, gate } = useRouteGuards({
    signedIn,
    loadingUser,
    user,
    isAdmin,
    surveyRequired,
  });
  const { timeZone, setTimeZone } = useTimeZoneState({
    signedIn,
    accountTimeZone: user?.timezone,
  });

  useEffect(() => {
    const loading = auth.isLoading || (loadingQuestions && questions === null);
    setStatus("app", loading ? "loading" : null);
    return () => setStatus("app", null);
  }, [auth.isLoading, loadingQuestions, questions, setStatus]);

  // A page visit asks the API to refresh OpenRouter's catalog. The API checks
  // its own 24-hour timestamp, so this is cheap on every other visit.
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    void fetchJsonAuthed<unknown>("/api/llm/models/refresh", auth, {
      method: "POST",
    }).catch(() => {
      // A catalog refresh must never block the page.
    });
  }, [auth]);

  function handleAnswersSaved(): void {
    setPlanRefreshKey((key) => key + 1);
    void loadQuestions();
  }

  return (
    <TimeZoneProvider timeZone={timeZone}>
      <NavigationProvider navigate={navigateToPage}>
        <div className="flex min-h-screen w-full flex-col">
          <AppHeader
            signedIn={signedIn}
            loading={auth.isLoading}
            firstName={auth.firstName}
            picture={auth.picture}
            isAdmin={isAdmin}
            status={status}
            page={page}
            installable={pwa.installable}
            onInstall={() => void pwa.install()}
            onNavigate={navigateToPage}
            onSignOut={() => void auth.logout()}
          />

          <PwaBanners
            offline={pwa.offline}
            updateReady={pwa.updateReady}
            onReload={() => pwa.reloadForUpdate()}
          />

          <AppBody
            signedIn={signedIn}
            authLoading={auth.isLoading}
            onSignIn={() => void auth.login()}
            questions={questions}
            questionsLoading={loadingQuestions}
            questionsError={questionsError}
            onRetryQuestions={() => void loadQuestions()}
            gate={gate}
            page={page}
            isAdmin={isAdmin}
            planRefreshKey={planRefreshKey}
            timeZone={timeZone}
            onAnswersSaved={handleAnswersSaved}
            onTimeZoneChanged={setTimeZone}
          />
        </div>
      </NavigationProvider>
    </TimeZoneProvider>
  );
}
