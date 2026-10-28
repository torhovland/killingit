import { useEffect, useState } from "react";
import {
  coachPlanResponseSchema,
  type PlanGenerateMode,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const PRIMARY_BUTTON =
  "rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted disabled:opacity-50";

type PlanAction = Extract<PlanGenerateMode, "newSeason" | "updateSeason">;

/**
 * Explicit plan regeneration actions. "Plan a new season" starts over from
 * today; "Update season plan" keeps the completed part of the stored season and
 * re-plans the rest. The second action is only offered when there is a season
 * containing today.
 */
export function PlanRegenerationButtons() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const timeZone = useTimeZone();
  const [hasSeason, setHasSeason] = useState(false);
  const [running, setRunning] = useState<PlanAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;

    async function loadAvailability(): Promise<void> {
      try {
        const { today } = getToday(timeZone);
        const response = await fetchJsonAuthed<unknown>(
          `${API_URL}/api/coaching/plan?today=${today}`,
          auth,
        );
        const parsed = coachPlanResponseSchema.safeParse(response);
        if (cancelled || !parsed.success) {
          return;
        }
        const season = parsed.data.plan?.season;
        setHasSeason(
          season !== undefined &&
            today >= season.startDate &&
            today <= season.endDate,
        );
      } catch (err: unknown) {
        // Availability is advisory: without it the athlete can still start a
        // new season, which is always a valid action.
        console.error("Failed to check for an existing season:", err);
      }
    }

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated, timeZone]);

  useEffect(() => {
    if (running === null) {
      setStatus("regenerate-plan", null);
      return;
    }
    setStatus("regenerate-plan", "thinking");
    return () => setStatus("regenerate-plan", null);
  }, [running, setStatus]);

  async function regenerate(action: PlanAction): Promise<void> {
    setRunning(action);
    setError(null);
    setDone(false);
    const { today, isAfter18 } = getToday(timeZone);
    try {
      const request = fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/plan/generate`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone: timeZone,
            mode: action,
            includeTomorrow: isAfter18,
          }),
        },
      );
      let requestDone = false;
      void request
        .finally(() => {
          requestDone = true;
        })
        .catch(() => {
          // The status endpoint carries the error; polling shows it.
        });

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const response = await fetchJsonAuthed<unknown>(
          `${API_URL}/api/coaching/plan?today=${today}&includeTomorrow=${isAfter18}`,
          auth,
        );
        const parsed = coachPlanResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(
            "Checking the plan status returned an unexpected response",
            { cause: parsed.error },
          );
        }
        if (parsed.data.generation.status === "running") {
          continue;
        }
        if (parsed.data.generation.status === "error") {
          throw new Error(
            parsed.data.generation.error ?? "The coach could not finish.",
          );
        }
        // A `done` status from the previous run must not finish us before the
        // new request has started.
        if (requestDone) {
          setDone(true);
          // Both actions leave a season that contains today.
          setHasSeason(true);
          return;
        }
      }
      throw new Error(
        "The coach is taking longer than expected. Check the plan on the main page.",
      );
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setRunning(null);
    }
  }

  return (
    <PlanRegenerationButtonsView
      hasSeason={hasSeason}
      running={running}
      done={done}
      error={error}
      onNewSeason={() => void regenerate("newSeason")}
      onUpdateSeason={() => void regenerate("updateSeason")}
    />
  );
}

interface PlanRegenerationButtonsViewProps {
  hasSeason: boolean;
  running: PlanAction | null;
  done: boolean;
  error: string | null;
  onNewSeason: () => void;
  onUpdateSeason: () => void;
}

/** Pure presentation, so the button availability can be tested directly. */
export function PlanRegenerationButtonsView({
  hasSeason,
  running,
  done,
  error,
  onNewSeason,
  onUpdateSeason,
}: PlanRegenerationButtonsViewProps) {
  const busy = running !== null;
  // Updating a season is the safer default whenever there is one: it keeps the
  // completed blocks. Starting over is only primary when it is the sole action.
  const actions: Array<{
    action: PlanAction;
    label: string;
    primary: boolean;
    onClick: () => void;
  }> = [
    ...(hasSeason
      ? [
          {
            action: "updateSeason" as const,
            label: "Update season plan",
            primary: true,
            onClick: onUpdateSeason,
          },
        ]
      : []),
    {
      action: "newSeason",
      label: "Plan a new season",
      primary: !hasSeason,
      onClick: onNewSeason,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((entry) => (
          <SubmitButton
            key={entry.action}
            type="button"
            busy={running === entry.action}
            className={entry.primary ? PRIMARY_BUTTON : SECONDARY_BUTTON}
            disabled={busy}
            onClick={entry.onClick}
          >
            {running === entry.action ? "Coach is thinking…" : entry.label}
          </SubmitButton>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {hasSeason
          ? "Updating keeps completed blocks and re-plans the rest of this season. A new season starts today."
          : "A new season starts today."}
      </p>
      {done && (
        <p className="text-sm text-success" role="status">
          Your plan is up to date.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
