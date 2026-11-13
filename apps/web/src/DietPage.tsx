import { dietSummaryResponseSchema } from "@killingit/shared";
import { useAuth } from "./auth";
import { DietView } from "./DietView";
import { useNavigate } from "./navigation";
import { useTimeZone } from "./TimeZoneContext";
import { useApiResource } from "./useApiResource";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Loads the diet goal and the daily food log for the Diet page. */
export function DietPage({ dietAdvice }: { dietAdvice: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const today = getToday(timeZone).today;
  const query = new URLSearchParams({ today }).toString();
  const summary = useApiResource(
    auth.isAuthenticated ? `${API_URL}/api/diet/summary?${query}` : null,
    dietSummaryResponseSchema,
    "Loading your diet log",
    { statusSource: "diet-page" },
  );

  return (
    <DietView
      dietAdvice={dietAdvice}
      summary={summary.data}
      today={today}
      loading={summary.loading}
      error={summary.error}
      onRetry={summary.reload}
      onOpenSettings={() => navigate("settings")}
      onOpenSurvey={() => navigate("survey")}
      onEntryUpdated={summary.reload}
    />
  );
}
