import { useEffect, useRef, useState } from "react";
import {
  coachPlanResponseSchema,
  dietSummaryResponseSchema,
  type CoachPlanResponse,
  type DietDaySummary,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { CoachPlanView } from "./CoachPlanView";
import { saveBlob } from "./download";
import { fetchFileAuthed, fetchJsonAuthed } from "./fetchAuthed";
import { useNavigate } from "./navigation";
import { usePlanGeneration } from "./PlanGenerationProvider";
import { PlanProgress } from "./PlanProgress";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface CoachPlanSectionProps {
  /** Increment after answers are saved so the section regenerates the plan. */
  refreshKey: number;
  /** Garmin and OpenRouter must both be configured to generate a plan. */
  ready: boolean;
  /** Whether the athlete wants the food log and its calorie panel. */
  dietAdvice?: boolean;
  /** Called when a generation finishes, so activity analyses can be reloaded. */
  onGenerated?: () => void;
}

/**
 * The four-level coach plan. Loads the stored plan and fills in anything
 * missing for today. Generation and polling live in `PlanGenerationProvider`,
 * so the header spinner keeps reporting the run on every page. The old plan
 * stays visible during a regeneration, except on the Day, Week, and Block tabs
 * where a superseded level is greyed out until its replacement arrives.
 */
export function CoachPlanSection({
  refreshKey,
  ready,
  dietAdvice = false,
  onGenerated,
}: CoachPlanSectionProps) {
  const auth = useAuth();
  const { status } = useAppStatus();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
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
  const [downloadingWorkoutDate, setDownloadingWorkoutDate] = useState<
    string | null
  >(null);

  async function fetchPlan(
    today: string,
    includeTomorrow: boolean,
  ): Promise<CoachPlanResponse> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/plan?today=${today}&includeTomorrow=${includeTomorrow}`,
      auth,
    );
    const parsed = coachPlanResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("Loading your plan returned an unexpected response", {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  async function fetchDietToday(): Promise<DietDaySummary | null> {
    if (!dietAdvice) {
      return null;
    }
    try {
      const query = new URLSearchParams({ today }).toString();
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/diet/summary?${query}`,
        auth,
      );
      const parsed = dietSummaryResponseSchema.safeParse(response);
      if (!parsed.success) {
        return null;
      }
      return parsed.data.days.find((day) => day.date === today) ?? null;
    } catch (err: unknown) {
      // The plan must still render when the diet summary cannot be read.
      console.error("Failed to load today's calories:", err);
      return null;
    }
  }

  async function load(): Promise<CoachPlanResponse | null> {
    setLoading(true);
    setError(null);
    try {
      const [result, diet] = await Promise.all([
        fetchPlan(today, isAfter18),
        fetchDietToday(),
      ]);
      setData(result);
      setDietToday(diet);
      return result;
    } catch (err: unknown) {
      setError(reportError(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function downloadWorkout(date: string): Promise<void> {
    setDownloadingWorkoutDate(date);
    setError(null);
    try {
      const { blob, filename } = await fetchFileAuthed(
        `${API_URL}/api/coaching/plan/workouts/${date}`,
        auth,
      );
      saveBlob(blob, filename ?? `${date}-workout.zwo`);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setDownloadingWorkoutDate(null);
    }
  }

  // Every status poll gives the provider a fresher plan than the section has,
  // so keep the view in step with it.
  useEffect(() => {
    if (latest !== null) {
      setData(latest);
    }
  }, [latest]);

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
    let cancelled = false;

    async function run(): Promise<void> {
      const result = await load();
      if (cancelled || result === null) {
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
      const needsUpdate =
        result.stale ||
        result.pending.initial ||
        result.pending.day ||
        result.pending.week ||
        result.pending.block ||
        result.pending.tomorrow ||
        result.pending.nextWeek ||
        result.pending.nextBlock;
      if (needsUpdate && ready) {
        void start("auto");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated, ready, refreshKey, start, track, dietAdvice]);

  // The stored generation error is shown in its own block with a retry action;
  // a provider error is only surfaced when the stored plan does not carry it.
  const planError =
    error ?? (data?.generation.status === "error" ? null : generationError);
  const setupError =
    data?.generation.status === "error" ? data.generation.error : null;

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section
      className="flex w-full flex-col gap-4 rounded-lg border bg-card p-4 text-left"
      data-testid="coach-plan"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">Your plan</h2>
          <p className="text-base text-muted-foreground">
            {data?.generatedAt
              ? `Generated ${formatDateTime(data.generatedAt, timeZone)}`
              : "Your coach builds the season, block, week, and today from your profile and recent training."}
          </p>
        </div>
      </div>

      {!ready && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-inset p-3 text-base">
          <span className="text-muted-foreground">
            Connect Garmin and OpenRouter to generate your training plan.
          </span>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 enabled:hover:bg-muted"
            onClick={() => navigate("settings")}
          >
            Open settings
          </button>
        </div>
      )}

      {planError && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-destructive" data-testid="plan-error">
            Error: {planError}
          </p>
          {!running && (
            <button
              type="button"
              className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted"
              onClick={() => void start("auto")}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {setupError && !running && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded border bg-inset p-3 text-base"
          data-testid="plan-generation-error"
        >
          <p className="text-destructive">
            The coach could not finish your plan: {setupError}
          </p>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted"
            onClick={() => void start("auto")}
          >
            Try again
          </button>
        </div>
      )}

      <PlanProgress
        progress={progress}
        status={running ? "thinking" : status}
      />

      {loading && data === null && (
        <p
          className="text-base text-muted-foreground"
          data-testid="plan-loading"
        >
          Loading your plan…
        </p>
      )}

      {data?.plan ? (
        <CoachPlanView
          plan={data.plan}
          showTomorrow={isAfter18}
          refreshingDays={{
            today: running && data.pending.day,
            tomorrow: running && data.pending.tomorrow,
          }}
          refreshingWeeks={{
            week: running && data.pending.week,
            nextWeek: running && data.pending.nextWeek,
          }}
          refreshingBlocks={{
            block: running && data.pending.block,
            nextBlock: running && data.pending.nextBlock,
          }}
          onDownloadWorkout={(date) => void downloadWorkout(date)}
          downloadingWorkoutDate={downloadingWorkoutDate}
          thresholds={data.thresholds}
          events={data.events}
          {...(dietAdvice ? { dietToday } : {})}
          showCalories={dietAdvice}
        />
      ) : (
        !loading &&
        ready && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-base text-muted-foreground">
              No plan yet. Your coach will build it from your profile and recent
              training.
            </p>
            <SubmitButton
              type="button"
              busy={running}
              className="rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
              onClick={() => void start("auto")}
            >
              {running ? "Coach is thinking…" : "Generate my plan"}
            </SubmitButton>
          </div>
        )
      )}
    </section>
  );
}
