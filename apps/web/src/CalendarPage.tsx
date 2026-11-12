import { useEffect, useState } from "react";
import {
  calendarResponseSchema,
  type CalendarResponse,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { monthOf } from "./calendarDates";
import { CalendarView } from "./CalendarView";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Loads the calendar's activities, plan sessions, and range bounds. */
export function CalendarPage() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [month, setMonth] = useState(() => monthOf(today));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus("calendar-page", loading ? "loading" : null);
    return () => setStatus("calendar-page", null);
  }, [loading, setStatus]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ today, timezone: timeZone }).toString();
    requestParsed(
      `${API_URL}/api/calendar?${query}`,
      auth,
      calendarResponseSchema,
      "Loading the calendar",
    )
      .then((data) => {
        if (!cancelled) {
          setData(data);
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
  }, [auth, timeZone, today]);

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <CalendarView
      data={data}
      month={month}
      onMonthChange={setMonth}
      today={today}
      loading={loading}
      error={error}
    />
  );
}
