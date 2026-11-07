import { useEffect, useState } from "react";
import {
  dietSummaryResponseSchema,
  type DietSummaryResponse,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { DietView } from "./DietView";
import { fetchJsonAuthed } from "./fetchAuthed";
import { useNavigate } from "./navigation";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Loads the diet goal and the daily food log for the Diet page. */
export function DietPage({ dietAdvice }: { dietAdvice: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { setStatus } = useAppStatus();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const [summary, setSummary] = useState<DietSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("diet-page", loading ? "loading" : null);
    return () => setStatus("diet-page", null);
  }, [loading, setStatus]);

  async function loadSummary(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ today }).toString();
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/diet/summary?${query}`,
        auth,
      );
      const parsed = dietSummaryResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading your diet log returned an unexpected response",
          {
            cause: parsed.error,
          },
        );
      }
      setSummary(parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.isAuthenticated) {
      void loadSummary();
    }
    // Only re-run when sign-in flips or the day changes; `auth` is consumed
    // inside and is not guaranteed to be referentially stable.
  }, [auth.isAuthenticated, today]);

  return (
    <DietView
      dietAdvice={dietAdvice}
      summary={summary}
      today={today}
      loading={loading}
      error={error}
      onRetry={() => void loadSummary()}
      onOpenSettings={() => navigate("settings")}
      onOpenSurvey={() => navigate("survey")}
      onEntryUpdated={() => void loadSummary()}
    />
  );
}
