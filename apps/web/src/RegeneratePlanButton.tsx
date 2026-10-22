import { useEffect, useState } from "react";
import { coachPlanResponseSchema } from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Starts a forced plan regeneration and reports the coach's progress through
 * the shared header spinner. Used on the settings and coaching-survey pages.
 */
export function RegeneratePlanButton() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) {
      setStatus("regenerate-plan", null);
      return;
    }
    setStatus("regenerate-plan", "thinking");
    return () => setStatus("regenerate-plan", null);
  }, [running, setStatus]);

  async function regenerate(): Promise<void> {
    setRunning(true);
    setError(null);
    setDone(false);
    const { today, isAfter18 } = getToday();
    try {
      await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/plan/generate`,
        auth,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone:
              Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            force: true,
            includeTomorrow: isAfter18,
          }),
        },
      );

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
        setDone(true);
        return;
      }
      throw new Error(
        "The coach is taking longer than expected. Check the plan on the main page.",
      );
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
        onClick={() => void regenerate()}
        disabled={running}
      >
        {running ? "Coach is thinking…" : "Regenerate plan"}
      </button>
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
