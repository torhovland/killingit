import { useEffect, useRef, useState } from "react";
import {
  coachPlanResponseSchema,
  type CoachPlanResponse,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { CoachPlanView } from "./CoachPlanView";
import { saveBlob } from "./download";
import { fetchFileAuthed, fetchJsonAuthed } from "./fetchAuthed";
import { useNavigate } from "./navigation";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface CoachPlanSectionProps {
  /** Increment after answers are saved so the section regenerates the plan. */
  refreshKey: number;
  /** Garmin and OpenRouter must both be configured to generate a plan. */
  ready: boolean;
  /** Called when a generation finishes, so activity analyses can be reloaded. */
  onGenerated?: () => void;
}

/**
 * The four-level coach plan. Loads the stored plan, fills in anything missing
 * for today, and polls while the coach is thinking so the user sees progress.
 * The old plan stays visible during a regeneration, except on the Day, Week,
 * and Block tabs where a superseded level is greyed out until its replacement
 * arrives.
 */
export function CoachPlanSection({
  refreshKey,
  ready,
  onGenerated,
}: CoachPlanSectionProps) {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const { today, isAfter18 } = getToday(timeZone);
  const [data, setData] = useState<CoachPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloadingWorkoutDate, setDownloadingWorkoutDate] = useState<
    string | null
  >(null);
  const inFlight = useRef(false);
  const pendingRefresh = useRef(false);

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

  async function load(): Promise<CoachPlanResponse | null> {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPlan(today, isAfter18);
      setData(result);
      return result;
    } catch (err: unknown) {
      setError(reportError(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function pollUntilDone(
    today: string,
    request: Promise<unknown> | null,
    includeTomorrow = false,
  ): Promise<CoachPlanResponse | null> {
    let requestDone = request === null;
    if (request !== null) {
      void request
        .finally(() => {
          requestDone = true;
        })
        .catch(() => {
          // The status endpoint carries the error; polling shows it.
        });
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      let result: CoachPlanResponse;
      try {
        result = await fetchPlan(today, includeTomorrow);
      } catch (err: unknown) {
        setError(reportError(err));
        return null;
      }
      setData(result);

      if (result.generation.status === "running") {
        continue;
      }
      if (result.generation.status === "error") {
        return result;
      }
      // A `done` status from the previous run must not stop us before the new
      // request has even started; wait for the request to settle.
      if (result.generation.status === "done" && requestDone) {
        return result;
      }
    }

    setError(
      "The coach is taking longer than expected. Refresh to check again.",
    );
    return null;
  }

  async function generate(force: boolean): Promise<void> {
    if (inFlight.current) {
      // Answers may have changed while a run was already in flight. Queue one
      // more pass so the saved answers are not missed.
      pendingRefresh.current = true;
      return;
    }
    inFlight.current = true;
    setGenerating(true);
    setError(null);

    const includeTomorrow = isAfter18;
    const request = fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/plan/generate`,
      auth,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today,
          timezone: timeZone,
          force,
          includeTomorrow,
        }),
      },
    );

    try {
      const result = await pollUntilDone(today, request, includeTomorrow);
      if (result?.generation.status === "done") {
        onGenerated?.();
      }
    } finally {
      setGenerating(false);
      inFlight.current = false;
      if (pendingRefresh.current) {
        pendingRefresh.current = false;
        void generate(false);
      }
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

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;

    async function run(): Promise<void> {
      const result = await load();
      if (cancelled || result === null) {
        return;
      }
      if (result.generation.status === "running") {
        const final = await pollUntilDone(today, null);
        if (final?.generation.status === "done") {
          onGenerated?.();
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
        await generate(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // Re-run when sign-in, integration readiness, or the answers change.
  }, [auth.isAuthenticated, ready, refreshKey]);

  const running =
    generating || (data?.generation.status === "running" && error === null);

  useEffect(() => {
    setStatus("coach-plan", running ? "thinking" : null);
    return () => setStatus("coach-plan", null);
  }, [running, setStatus]);

  if (!auth.isAuthenticated) {
    return null;
  }

  // While a new run is starting, the stored status is still the previous run's
  // `done` (often 100%). Show a neutral starting state until the first poll.
  const progress =
    generating && data?.generation.status !== "running"
      ? { step: "Waking the coach…", progress: 0 }
      : data?.generation;
  const setupError =
    data?.generation.status === "error" ? data.generation.error : null;

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

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-destructive" data-testid="plan-error">
            Error: {error}
          </p>
          {!generating && (
            <button
              type="button"
              className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted"
              onClick={() => void generate(false)}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {setupError && !generating && (
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
            onClick={() => void generate(false)}
          >
            Try again
          </button>
        </div>
      )}

      {running && (
        <div
          className="flex flex-col gap-2 rounded border bg-inset p-3"
          data-testid="plan-progress"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="font-medium">
              {progress?.step ?? "The coach is thinking…"}
            </span>
            <span className="text-muted-foreground">
              {progress?.progress ?? 0}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-card">
            <div
              // Match the poll interval so each small increase blends into a
              // continuous move instead of a visible step.
              className="h-full rounded bg-primary transition-[width] duration-[1500ms] ease-linear"
              // Dynamic width is the one value that must be inline.
              style={{ width: `${progress?.progress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {data?.stale && ready && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-inset p-3 text-base">
          <span>
            Your coaching inputs changed, so your plan is out of date.
          </span>
          <SubmitButton
            type="button"
            busy={running}
            className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
            onClick={() => void generate(false)}
          >
            {running ? "Coach is thinking…" : "Update plan"}
          </SubmitButton>
        </div>
      )}

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
              onClick={() => void generate(false)}
            >
              {running ? "Coach is thinking…" : "Generate my plan"}
            </SubmitButton>
          </div>
        )
      )}
    </section>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
