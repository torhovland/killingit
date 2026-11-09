import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  coachPlanResponseSchema,
  type CoachPlanResponse,
  type PlanGenerateMode,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { fetchJsonAuthed, requestParsed } from "./fetchAuthed";
import { initialPlanProgress, type PlanProgressState } from "./PlanProgress";
import {
  pollPlanGeneration,
  type PlanGenerationOutcome,
} from "./planGeneration";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface PlanGenerationContextValue {
  /** Whether the coach is currently generating or refreshing the plan. */
  running: boolean;
  /** The mode of the running generation, or null when none is running. */
  mode: PlanGenerateMode | null;
  /** The step and percentage to show while the run is in progress. */
  progress: PlanProgressState | null;
  /** The newest plan response fetched while the run was tracked. */
  latest: CoachPlanResponse | null;
  /** Increments once per generation that reaches a terminal state. */
  revision: number;
  /** The last failure seen while starting, tracking, or polling a run. */
  error: string | null;
  /** Starts a generation and polls it to completion, whatever page is shown. */
  start: (mode?: PlanGenerateMode) => Promise<PlanGenerationOutcome>;
  /** Polls a generation that is already running on the server. */
  track: () => void;
}

const PlanGenerationContext = createContext<PlanGenerationContextValue | null>(
  null,
);

/**
 * Owns plan generation for the whole signed-in app. Keeping the polling here
 * rather than in a page means the header spinner stays visible on every page
 * while the coach works, even after the athlete navigates away from the page
 * that started the run.
 */
export function PlanGenerationProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const { setStatus } = useAppStatus();
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<PlanGenerateMode | null>(null);
  const [progress, setProgress] = useState<PlanProgressState | null>(null);
  const [latest, setLatest] = useState<CoachPlanResponse | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The polling loop outlives renders, so it reads the newest account and zone
  // from refs instead of the values captured when it started.
  const authRef = useRef(auth);
  authRef.current = auth;
  const timeZoneRef = useRef(timeZone);
  timeZoneRef.current = timeZone;
  const active = useRef<Promise<PlanGenerationOutcome> | null>(null);
  const queued = useRef<PlanGenerateMode | null>(null);
  /** Identifies the current run, so a superseded run cannot write state. */
  const runToken = useRef(0);
  const runRef = useRef<
    | ((
        generationMode: PlanGenerateMode,
        today: string,
        includeTomorrow: boolean,
        request: Promise<unknown> | null,
      ) => Promise<PlanGenerationOutcome>)
    | null
  >(null);

  useEffect(() => {
    setStatus("plan-generation", running ? "thinking" : null);
    return () => setStatus("plan-generation", null);
  }, [running, setStatus]);

  // Showing another account's plan while theirs loads would be wrong; drop
  // everything when the signed-in account changes or signs out.
  const account = auth.sub ?? null;
  const lastAccount = useRef(account);
  useEffect(() => {
    if (account === lastAccount.current) {
      return;
    }
    lastAccount.current = account;
    runToken.current += 1;
    active.current = null;
    queued.current = null;
    setRunning(false);
    setMode(null);
    setProgress(null);
    setLatest(null);
    setError(null);
    setRevision(0);
  }, [account]);

  const fetchPlan = useCallback(
    (today: string, includeTomorrow: boolean) =>
      requestParsed(
        `${API_URL}/api/coaching/plan?today=${today}&includeTomorrow=${includeTomorrow}`,
        authRef.current,
        coachPlanResponseSchema,
        "Loading your plan",
      ),
    [],
  );

  const onUpdate = useCallback((response: CoachPlanResponse) => {
    setLatest(response);
    setProgress(
      response.generation.status === "running"
        ? {
            step: response.generation.step,
            progress: response.generation.progress,
          }
        : null,
    );
  }, []);

  const runGeneration = useCallback(
    (
      generationMode: PlanGenerateMode,
      today: string,
      includeTomorrow: boolean,
      request: Promise<unknown> | null,
    ): Promise<PlanGenerationOutcome> => {
      const token = (runToken.current += 1);
      setRunning(true);
      setMode(generationMode);
      setProgress(initialPlanProgress(request));
      setError(null);

      const promise = pollPlanGeneration({
        today,
        includeTomorrow,
        request,
        fetchPlan,
        onUpdate: (response) => {
          if (runToken.current === token) {
            onUpdate(response);
          }
        },
        sleep,
        now: Date.now,
      })
        .then((outcome) => {
          if (runToken.current === token) {
            setError(outcome.status === "done" ? null : outcome.error);
          }
          return outcome;
        })
        .catch((pollError: unknown): PlanGenerationOutcome => {
          const message = reportError(pollError);
          if (runToken.current === token) {
            setError(message);
          }
          return { status: "error", error: message };
        })
        .finally(() => {
          if (runToken.current !== token) {
            return;
          }
          setRunning(false);
          setMode(null);
          setProgress(null);
          setRevision((value) => value + 1);
          active.current = null;
          // Answers or activity changes may have arrived while a run was in
          // flight; run the queued request now.
          const next = queued.current;
          queued.current = null;
          if (next !== null) {
            const { today: nextToday, isAfter18 } = getToday(
              timeZoneRef.current,
            );
            void runRef.current?.(next, nextToday, isAfter18, null);
          }
        });

      active.current = promise;
      return promise;
    },
    [fetchPlan, onUpdate],
  );
  runRef.current = runGeneration;

  const start = useCallback(
    (generationMode: PlanGenerateMode = "auto") => {
      if (active.current !== null) {
        queued.current = generationMode;
        return active.current;
      }
      const { today, isAfter18 } = getToday(timeZoneRef.current);
      const request = fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/plan/generate`,
        authRef.current,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone: timeZoneRef.current,
            mode: generationMode,
            includeTomorrow: isAfter18,
          }),
        },
      );
      return runGeneration(generationMode, today, isAfter18, request);
    },
    [runGeneration],
  );

  const track = useCallback(() => {
    if (active.current !== null) {
      return;
    }
    const { today, isAfter18 } = getToday(timeZoneRef.current);
    void runGeneration("auto", today, isAfter18, null);
  }, [runGeneration]);

  const value = useMemo<PlanGenerationContextValue>(
    () => ({
      running,
      mode,
      progress,
      latest,
      revision,
      error,
      start,
      track,
    }),
    [running, mode, progress, latest, revision, error, start, track],
  );

  return (
    <PlanGenerationContext.Provider value={value}>
      {children}
    </PlanGenerationContext.Provider>
  );
}

export function usePlanGeneration(): PlanGenerationContextValue {
  const value = useContext(PlanGenerationContext);
  if (value === null) {
    throw new Error(
      "usePlanGeneration must be used inside PlanGenerationProvider",
    );
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
