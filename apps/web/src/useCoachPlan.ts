import { useCallback, useEffect, useRef, useState } from "react";
import {
  dietSummaryResponseSchema,
  type CoachPlanResponse,
  type DietDaySummary,
  type PlanGenerateMode,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import {
  fetchCoachPlan,
  hasPendingWork,
  type PlanGenerationOutcome,
} from "./planGeneration";
import { usePlanGeneration } from "./PlanGenerationProvider";
import type { PlanProgressState } from "./PlanProgress";
import { reportError } from "./reportError";
import { useAbortableRequest } from "./useApiResource";
import { getToday } from "./useToday";

export interface CoachPlanOptions {
  /** Increment after answers are saved so the section regenerates the plan. */
  refreshKey: number;
  /** Garmin and OpenRouter must both be configured to generate a plan. */
  ready: boolean;
  /** Whether the athlete wants the food log and its calorie panel. */
  dietAdvice?: boolean;
  /** Called when a generation finishes, so activity analyses can be reloaded. */
  onGenerated?: (() => void) | undefined;
}

export interface CoachPlanState {
  /** The newest response: a tracked generation's or the loaded one. */
  data: CoachPlanResponse | null;
  /** Today's diet summary, when diet advice is on. */
  dietToday: DietDaySummary | null;
  loading: boolean;
  /** A failed load or generation, ready to show above the plan. */
  error: string | null;
  /** A stored generation failure, shown with its own retry action. */
  setupError: string | null;
  /** Whether the coach is generating or refreshing the plan right now. */
  running: boolean;
  /** The step and percentage to show while a run is in progress. */
  progress: PlanProgressState | null;
  /** Whether tomorrow's session belongs on the Day tab. */
  showTomorrow: boolean;
  /** Starts a generation of the stored plan. */
  start: (mode?: PlanGenerateMode) => Promise<PlanGenerationOutcome>;
}

/**
 * Loads the stored plan and today's diet summary, tracks a generation already
 * running on the server, and starts one when the plan is stale or missing a
 * level. A run's newest response wins over the loaded one, so the Day, Week and
 * Block tabs update while the coach works.
 */
export function useCoachPlan(
  auth: AuthState,
  timeZone: string,
  { refreshKey, ready, dietAdvice = false, onGenerated }: CoachPlanOptions,
): CoachPlanState {
  const {
    running,
    progress,
    latest,
    revision,
    error: generationError,
    start,
    track,
  } = usePlanGeneration();
  const { today, isAfter18 } = getToday(timeZone);
  const [data, setData] = useState<CoachPlanResponse | null>(null);
  const [dietToday, setDietToday] = useState<DietDaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(
    (
      today: string,
      includeTomorrow: boolean,
      signal: AbortSignal,
    ): Promise<CoachPlanResponse> =>
      fetchCoachPlan(auth, { today, includeTomorrow }, signal),
    [auth],
  );

  const fetchDietToday = useCallback(
    async (signal: AbortSignal): Promise<DietDaySummary | null> => {
      if (!dietAdvice) {
        return null;
      }
      try {
        const query = new URLSearchParams({ today }).toString();
        const summary = await requestParsed(
          `/api/diet/summary?${query}`,
          auth,
          dietSummaryResponseSchema,
          "Loading today's diet summary",
          { signal },
        );
        return summary.days.find((day) => day.date === today) ?? null;
      } catch (err: unknown) {
        // The plan must still render when the diet summary cannot be read.
        if (!signal.aborted) {
          console.error("Failed to load today's calories:", err);
        }
        return null;
      }
    },
    [auth, dietAdvice, today],
  );

  const [load, abortLoad] = useAbortableRequest(
    async (signal: AbortSignal): Promise<CoachPlanResponse | null> => {
      setLoading(true);
      setError(null);
      try {
        const [result, diet] = await Promise.all([
          fetchPlan(today, isAfter18, signal),
          fetchDietToday(signal),
        ]);
        if (signal.aborted) {
          return null;
        }
        setData(result);
        setDietToday(diet);
        return result;
      } catch (err: unknown) {
        if (!signal.aborted) {
          setError(reportError(err));
        }
        return null;
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
  );

  // A generation that finished after this section mounted may have refreshed
  // the activity analyses and reviews too.
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (revision === previousRevision.current) {
      return;
    }
    previousRevision.current = revision;
    onGenerated?.();
  }, [revision, onGenerated]);

  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    const refreshChanged = refreshKey !== lastRefreshKey.current;
    lastRefreshKey.current = refreshKey;

    void load().then((result) => {
      if (result === null) {
        return;
      }
      if (result.generation.status === "running") {
        track();
        // Answers changed while a run was in flight: run once more after it,
        // so the saved answers are not missed.
        if (refreshChanged) {
          void start("auto");
        }
        return;
      }
      if (result.generation.status === "error") {
        // Surface the failure and let the athlete retry explicitly instead of
        // re-billing the model on every page load.
        return;
      }
      if ((result.stale || hasPendingWork(result.pending)) && ready) {
        void start("auto");
      }
    });
    return abortLoad;
  }, [
    auth,
    ready,
    refreshKey,
    start,
    track,
    dietAdvice,
    load,
    abortLoad,
    today,
    isAfter18,
  ]);

  // Every status poll gives the provider a fresher plan than the initial load,
  // so the newest tracked response wins while it exists.
  const planData = latest ?? data;

  // The stored generation error is shown in its own block with a retry action;
  // a provider error is only surfaced when the stored plan does not carry it.
  const planError =
    error ?? (planData?.generation.status === "error" ? null : generationError);
  const setupError =
    planData?.generation.status === "error" ? planData.generation.error : null;

  return {
    data: planData,
    dietToday,
    loading,
    error: planError,
    setupError,
    running,
    progress,
    showTomorrow: isAfter18,
    start,
  };
}
