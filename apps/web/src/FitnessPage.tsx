import { useState } from "react";
import {
  DEFAULT_FITNESS_RANGE,
  fitnessHistoryResponseSchema,
  type FitnessRange,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { FitnessView } from "./FitnessView";
import { useTimeZone } from "./TimeZoneContext";
import { useApiResource } from "./useApiResource";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** The Fitness page: loads the daily load and FTP history for the athlete. */
export function FitnessPage() {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const [range, setRange] = useState<FitnessRange>(DEFAULT_FITNESS_RANGE);
  const query = new URLSearchParams({
    today,
    range,
    timezone: timeZone,
  }).toString();
  const history = useApiResource(
    auth.isAuthenticated ? `${API_URL}/api/fitness?${query}` : null,
    fitnessHistoryResponseSchema,
    "Loading the fitness history",
    { statusSource: "fitness-page" },
  );

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <FitnessView
      history={history.data}
      today={today}
      range={range}
      onRangeChange={setRange}
      loading={history.loading}
      error={history.error}
    />
  );
}
