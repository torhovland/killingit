import { useState } from "react";
import { calendarResponseSchema } from "@killingit/shared";
import { useAuth } from "./auth";
import { monthOf } from "./calendarDates";
import { CalendarView } from "./CalendarView";
import { useTimeZone } from "./TimeZoneContext";
import { useApiResource } from "./useApiResource";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Loads the calendar's activities, plan sessions, and range bounds. */
export function CalendarPage() {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const [month, setMonth] = useState(() => monthOf(today));
  const query = new URLSearchParams({ today, timezone: timeZone }).toString();
  const calendar = useApiResource(
    auth.isAuthenticated ? `${API_URL}/api/calendar?${query}` : null,
    calendarResponseSchema,
    "Loading the calendar",
    { statusSource: "calendar-page" },
  );

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <CalendarView
      data={calendar.data}
      month={month}
      onMonthChange={setMonth}
      today={today}
      loading={calendar.loading}
      error={calendar.error}
    />
  );
}
