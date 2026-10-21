import { useEffect, useState } from "react";
import {
  analyzedActivitiesResponseSchema,
  athleteQuestionsResponseSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type AnalyzedActivitiesResponse,
  type AthleteQuestion,
  type AthleteQuestionsResponse,
  type GarminConnectionStatus,
  type LlmSettings,
  type QuestionAnswerInput,
} from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { useAuth } from "./auth";
import { AthleteAnswersSection } from "./AthleteAnswersSection";
import { AthleteQuestionsForm } from "./AthleteQuestionsForm";
import { fetchJsonAuthed } from "./fetchAuthed";
import { GarminSection } from "./GarminSection";
import { LlmSection } from "./LlmSection";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Signed-in coaching entry point. Every active athlete question must be
 * resolved (answered, or explicitly skipped when optional) before the coaching
 * surface (statuses and activities) mounts, so activities are neither shown nor
 * fetched until onboarding is complete (ADR 0007).
 */
export function CoachDashboard() {
  const auth = useAuth();
  const [questions, setQuestions] = useState<AthleteQuestionsResponse | null>(
    null,
  );
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  async function loadQuestions(): Promise<void> {
    setLoadingQuestions(true);
    setQuestionsError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/questions`,
        auth,
      );
      const parsed = athleteQuestionsResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading your questions returned an unexpected response",
          {
            cause: parsed.error,
          },
        );
      }
      setQuestions(parsed.data);
    } catch (err: unknown) {
      setQuestionsError(reportError(err));
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function saveAnswers(submitted: QuestionAnswerInput[]): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/questions/answers`,
      auth,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: submitted }),
      },
    );
    const parsed = athleteQuestionsResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("Saving your answers returned an unexpected response", {
        cause: parsed.error,
      });
    }
    setQuestions(parsed.data);
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadQuestions();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  if (!auth.isAuthenticated) {
    return null;
  }

  if (loadingQuestions && questions === null) {
    return (
      <p className="text-sm opacity-60" data-testid="questions-loading">
        Loading your questions…
      </p>
    );
  }

  if (questions === null) {
    return (
      <section className="flex flex-col items-center gap-2">
        {questionsError && (
          <p className="text-red-500">Error: {questionsError}</p>
        )}
        <button
          type="button"
          className="rounded border px-4 py-2"
          onClick={() => void loadQuestions()}
        >
          Retry
        </button>
      </section>
    );
  }

  if (!questions.complete) {
    return (
      <AthleteQuestionsForm
        questions={questions.questions}
        onSubmit={saveAnswers}
      />
    );
  }

  return (
    <CoachingSurface
      questions={questions.questions}
      onSaveAnswers={saveAnswers}
    />
  );
}

interface CoachingSurfaceProps {
  questions: AthleteQuestion[];
  onSaveAnswers: (answers: QuestionAnswerInput[]) => Promise<void>;
}

/**
 * The coaching surface proper: review or edit athlete answers, connect Garmin,
 * configure OpenRouter, then show the latest synced activities with their coach
 * analyses. Analysis is cached server-side; "Re-analyze" forces a fresh pass.
 */
function CoachingSurface({ questions, onSaveAnswers }: CoachingSurfaceProps) {
  const auth = useAuth();
  const [garmin, setGarmin] = useState<GarminConnectionStatus | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [data, setData] = useState<AnalyzedActivitiesResponse | null>(null);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatuses(): Promise<void> {
    setLoadingStatuses(true);
    setError(null);
    try {
      const [garminRes, llmRes] = await Promise.all([
        fetchJsonAuthed<unknown>(`${API_URL}/api/garmin/status`, auth),
        fetchJsonAuthed<unknown>(`${API_URL}/api/llm/settings`, auth),
      ]);
      const garminParsed = garminConnectionStatusSchema.safeParse(garminRes);
      const llmParsed = llmSettingsSchema.safeParse(llmRes);
      if (!garminParsed.success || !llmParsed.success) {
        throw new Error("Status endpoints returned an unexpected response");
      }
      setGarmin(garminParsed.data);
      setLlm(llmParsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoadingStatuses(false);
    }
  }

  async function loadAnalyses(refresh = false): Promise<void> {
    setLoadingAnalyses(true);
    setError(null);
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities?limit=10${refresh ? "&refresh=true" : ""}`,
        auth,
      );
      const parsed = analyzedActivitiesResponseSchema.safeParse(res);
      if (!parsed.success) {
        throw new Error("Coaching endpoint returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setData(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoadingAnalyses(false);
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadStatuses();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!garmin?.connected) {
      return;
    }
    void loadAnalyses();
    // Re-run when Garmin connects or the LLM setup changes, not every render.
  }, [garmin?.connected, llm?.configured]);

  if (!auth.isAuthenticated) {
    return null;
  }

  if (loadingStatuses && (garmin === null || llm === null)) {
    return (
      <p className="text-sm opacity-60" data-testid="coach-loading">
        Loading integrations…
      </p>
    );
  }

  if (garmin === null || llm === null) {
    return (
      <section className="flex flex-col items-center gap-2">
        {error && <p className="text-red-500">Error: {error}</p>}
        <button
          type="button"
          className="rounded border px-4 py-2"
          onClick={() => void loadStatuses()}
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="flex w-full max-w-3xl flex-col gap-6 text-left">
      {error && (
        <p className="text-red-500" data-testid="coach-error">
          Error: {error}
        </p>
      )}

      <AthleteAnswersSection questions={questions} onSubmit={onSaveAnswers} />

      <GarminSection connected={garmin.connected} onConnected={setGarmin} />

      <LlmSection settings={llm} onSaved={setLlm} />

      {garmin.connected && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Latest activities</h2>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={() => void loadAnalyses(llm.configured)}
              disabled={loadingAnalyses}
            >
              {loadingAnalyses
                ? "Working…"
                : llm.configured
                  ? "Sync & re-analyze"
                  : "Sync activities"}
            </button>
          </div>

          {!llm.configured && (
            <p className="text-sm opacity-60">
              Configure OpenRouter above to add coach analysis.
            </p>
          )}

          {loadingAnalyses && data === null && (
            <p className="text-sm opacity-60" data-testid="analysis-loading">
              {llm.configured
                ? "Syncing Garmin and asking the coach to analyse your workouts…"
                : "Syncing Garmin activities…"}
            </p>
          )}

          {!loadingAnalyses && data && data.activities.length === 0 && (
            <p className="text-sm opacity-60">
              No activities in the last 31 days.
            </p>
          )}

          {data?.activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </section>
      )}
    </section>
  );
}
