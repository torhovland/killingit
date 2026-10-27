import { useEffect, useState } from "react";
import {
  fitnessHistoryResponseSchema,
  type FitnessHistoryResponse,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { FitnessView } from "./FitnessView";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** The Fitness page: loads the daily load and FTP history for the athlete. */
export function FitnessPage() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const [history, setHistory] = useState<FitnessHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("fitness-page", loading ? "loading" : null);
    return () => setStatus("fitness-page", null);
  }, [loading, setStatus]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ today }).toString();
    fetchJsonAuthed<unknown>(`${API_URL}/api/fitness?${query}`, auth)
      .then((response) => {
        const parsed = fitnessHistoryResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new Error(
            "The fitness history returned an unexpected response",
            {
              cause: parsed.error,
            },
          );
        }
        if (!cancelled) {
          setHistory(parsed.data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(reportError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // `auth` is consumed inside and is not guaranteed to be referentially
    // stable, so only the sign-in state and the date re-run the request.
  }, [auth.isAuthenticated, today]);

  if (!auth.isAuthenticated) {
    return null;
  }

  return <FitnessView history={history} today={today} error={error} />;
}
