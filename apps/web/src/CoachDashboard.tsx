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
import { CoachPlanSection } from "./CoachPlanSection";
import { fetchJsonAuthed } from "./fetchAuthed";
import { GarminSection } from "./GarminSection";
import { LlmSection } from "./LlmSection";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

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
  const [weeklyNote, setWeeklyNote] = useState<string>("");

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

  async function fetchWeeklyNote(): Promise<void> {
    try {
      const { today } = getToday();
      const response = await fetchJsonAuthed<{ note: string | null }>(
        `${API_URL}/api/coaching/weekly/notes?today=${today}`,
        auth,
      );
      setWeeklyNote(response.note ?? "");
    } catch (err: unknown) {
      // Don't block the dashboard if the note fails to load.
      console.error("Failed to load weekly note:", err);
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
    void fetchWeeklyNote();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  if (!auth.isAuthenticated) {
    return null;
  }

  if (loadingQuestions && questions === null) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="questions-loading"
      >
        Loading your questions…
      </p>
    );
  }

  if (questions === null) {
    return (
      <section className="flex flex-col items-center gap-2">
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
      weeklyNote={weeklyNote}
      onWeeklyNoteChange={setWeeklyNote}
    />
  );
}

interface ManualActivity {
  id: number;
  startDate: string;
  details: string;
}

interface CoachingSurfaceProps {
  questions: AthleteQuestion[];
  onSaveAnswers: (answers: QuestionAnswerInput[]) => Promise<void>;
  weeklyNote: string;
  onWeeklyNoteChange: (note: string) => void;
}

/**
 * The coaching surface proper: review or edit athlete answers, connect Garmin,
 * configure OpenRouter, then show the latest synced activities with their coach
 * analyses. Analysis is cached server-side; "Re-analyze" forces a fresh pass.
 */
function CoachingSurface({
  questions,
  onSaveAnswers,
  weeklyNote,
  onWeeklyNoteChange,
}: CoachingSurfaceProps) {
  const auth = useAuth();
  const [garmin, setGarmin] = useState<GarminConnectionStatus | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [data, setData] = useState<AnalyzedActivitiesResponse | null>(null);
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [manualActivities, setManualActivities] = useState<ManualActivity[]>(
    [],
  );
  const [editingActivityId, setEditingActivityId] = useState<number | null>(
    null,
  );
  const [manualStartDate, setManualStartDate] = useState(getToday().today);
  const [manualDetails, setManualDetails] = useState("");

  async function saveAnswers(answers: QuestionAnswerInput[]): Promise<void> {
    await onSaveAnswers(answers);
    // Answers changed: refetch the plan status, which marks the stored plan
    // stale and starts a regeneration.
    setPlanRefreshKey((key) => key + 1);
  }

  async function handleWeeklyNoteSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!weeklyNote.trim()) {
      return;
    }
    try {
      await submitWeeklyNote(weeklyNote);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  async function handleManualActivitySubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!manualStartDate || !manualDetails.trim()) {
      return;
    }
    try {
      if (editingActivityId !== null) {
        await updateManualActivity(editingActivityId, {
          startDate: manualStartDate,
          details: manualDetails,
        });
        setEditingActivityId(null);
      } else {
        await submitManualActivity({
          startDate: manualStartDate,
          details: manualDetails,
        });
      }
      await loadManualActivities();
      setManualStartDate(getToday().today);
      setManualDetails("");
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  function handleEditActivity(activity: ManualActivity): void {
    setEditingActivityId(activity.id);
    setManualStartDate(activity.startDate);
    setManualDetails(activity.details);
  }

  function handleCancelEdit(): void {
    setEditingActivityId(null);
    setManualStartDate(getToday().today);
    setManualDetails("");
  }

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

  async function loadManualActivities(): Promise<void> {
    try {
      const response = await fetchJsonAuthed<{
        manualActivities: ManualActivity[];
      }>(`${API_URL}/api/coaching/activities/manual`, auth);
      setManualActivities(response.manualActivities);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  async function submitComment(
    activityId: string,
    comment: string,
  ): Promise<void> {
    const { today } = getToday();
    await fetchJsonAuthed(
      `${API_URL}/api/coaching/activities/${activityId}/comments`,
      auth,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
          comment,
        }),
      },
    );
    // The server saved the comment and started a plan revision. Refresh the
    // plan section so the athlete sees the coach's response.
    setPlanRefreshKey((key) => key + 1);
  }

  async function submitWeeklyNote(note: string): Promise<void> {
    const { today } = getToday();
    await fetchJsonAuthed(`${API_URL}/api/coaching/weekly/notes`, auth, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        today,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        note,
      }),
    });
    setPlanRefreshKey((key) => key + 1);
  }

  async function submitManualActivity(activity: {
    startDate: string;
    details: string;
  }): Promise<void> {
    const { today } = getToday();
    await fetchJsonAuthed(`${API_URL}/api/coaching/activities/manual`, auth, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        today,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        ...activity,
      }),
    });
    setPlanRefreshKey((key) => key + 1);
  }

  async function updateManualActivity(
    activityId: number,
    activity: { startDate: string; details: string },
  ): Promise<void> {
    const { today } = getToday();
    await fetchJsonAuthed(
      `${API_URL}/api/coaching/activities/manual/${activityId}`,
      auth,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
          ...activity,
        }),
      },
    );
    setPlanRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadStatuses();
    void loadManualActivities();
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
      <p className="text-sm text-muted-foreground" data-testid="coach-loading">
        Loading integrations…
      </p>
    );
  }

  if (garmin === null || llm === null) {
    return (
      <section className="flex flex-col items-center gap-2">
        {error && <p className="text-destructive">Error: {error}</p>}
        <button
          type="button"
          className="rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
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
        <p className="text-destructive" data-testid="coach-error">
          Error: {error}
        </p>
      )}

      <CoachPlanSection
        refreshKey={planRefreshKey}
        ready={garmin.connected && llm.configured}
      />

      <AthleteAnswersSection questions={questions} onSubmit={saveAnswers} />

      <GarminSection connected={garmin.connected} onConnected={setGarmin} />

      <LlmSection settings={llm} onSaved={setLlm} />

      <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 text-left">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Coaching inputs</h2>
          <p className="text-sm text-muted-foreground">
            These inputs are sent to your coach when generating your plan.
            Saving one automatically triggers a plan refresh.
          </p>
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void handleWeeklyNoteSubmit(event)}
        >
          <label className="text-sm font-medium" htmlFor="weekly-note">
            Weekly note
          </label>
          <textarea
            id="weekly-note"
            name="note"
            className="w-full rounded border bg-card p-2 text-sm"
            placeholder="e.g. I won't have time to train on Thursday this week."
            rows={2}
            value={weeklyNote}
            onChange={(event) => onWeeklyNoteChange(event.target.value)}
          />
          <button
            type="submit"
            className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover"
          >
            Save weekly note
          </button>
        </form>

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void handleManualActivitySubmit(event)}
        >
          <label className="text-sm font-medium" htmlFor="manual-start-date">
            {editingActivityId ? "Edit manual activity" : "Manual activity"}
          </label>
          <input
            id="manual-start-date"
            name="startDate"
            type="date"
            className="w-fit rounded border bg-card px-2 py-1 text-sm"
            value={manualStartDate}
            onChange={(event) => setManualStartDate(event.target.value)}
          />
          <textarea
            name="details"
            placeholder="Describe your activity"
            className="w-full rounded border bg-card p-2 text-sm"
            rows={2}
            value={manualDetails}
            onChange={(event) => setManualDetails(event.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover"
            >
              {editingActivityId ? "Update activity" : "Add manual activity"}
            </button>
            {editingActivityId && (
              <button
                type="button"
                className="self-start rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {manualActivities.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Saved manual activities</h3>
            <ul className="flex flex-col gap-1">
              {manualActivities.map((activity) => (
                <li
                  key={activity.id}
                  className="flex items-start justify-between gap-2 rounded border bg-card p-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{activity.startDate}</span> —{" "}
                    {activity.details}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => handleEditActivity(activity)}
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {garmin.connected && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Latest activities</h2>
            <button
              type="button"
              className="rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
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
            <p className="text-sm text-muted-foreground">
              Configure OpenRouter above to add coach analysis.
            </p>
          )}

          {loadingAnalyses && data === null && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="analysis-loading"
            >
              {llm.configured
                ? "Syncing Garmin and asking the coach to analyse your workouts…"
                : "Syncing Garmin activities…"}
            </p>
          )}

          {!loadingAnalyses && data && data.activities.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No activities in the last 31 days.
            </p>
          )}

          {data?.activities.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onSubmitComment={submitComment}
            />
          ))}
        </section>
      )}
    </section>
  );
}
