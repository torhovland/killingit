import { useEffect, useState } from "react";
import {
  analyzedActivitiesResponseSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type AnalyzedActivitiesResponse,
  type GarminConnectionStatus,
  type LlmSettings,
} from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { AdminQuestionsSection } from "./AdminQuestionsSection";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { GarminSection } from "./GarminSection";
import { LlmSection } from "./LlmSection";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Signed-in coaching surface: connect Garmin, configure OpenRouter, then show
 * the latest synced activities with their coach analyses. Analysis is cached
 * server-side; "Re-analyze" forces a fresh pass.
 */
export function CoachDashboard() {
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

      <GarminSection connected={garmin.connected} onConnected={setGarmin} />

      <LlmSection settings={llm} onSaved={setLlm} />

      <AdminQuestionsSection />

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
