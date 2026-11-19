import { useEffect, useState } from "react";
import type { PlanGenerateMode } from "@killingit/shared";
import { useAuth } from "../auth";
import { useNavigate } from "../navigation";
import { fetchCoachPlan } from "./planGeneration";
import { usePlanGeneration } from "./PlanGenerationProvider";
import { isAbortError } from "../requestAbort";
import { reportErrorQuietly } from "../reportError";
import { SubmitButton } from "../SubmitButton";
import { useTimeZone } from "../TimeZoneContext";
import { useAbortableRequest } from "../useApiResource";
import { useStatuses, type IntegrationStatuses } from "../useStatuses";
import { getToday } from "../useToday";

type PlanAction = Extract<PlanGenerateMode, "newSeason" | "updateSeason">;

interface IntegrationSetup {
  garminConnected: boolean;
  llmConfigured: boolean;
}

/**
 * The setup the athlete still needs before a new season can be planned, or
 * `null` when Garmin and OpenRouter are both ready.
 */
function seasonSetupNotice({
  garminConnected,
  llmConfigured,
}: IntegrationSetup): string | null {
  if (garminConnected && llmConfigured) {
    return null;
  }
  const missing = [
    ...(garminConnected ? [] : ["Garmin"]),
    ...(llmConfigured ? [] : ["an OpenRouter API key"]),
  ];
  const joined =
    missing.length === 2 ? `${missing[0]} and ${missing[1]}` : missing[0];
  return `Set up ${joined} in Settings before planning a new season.`;
}

/**
 * The setup notice to show, or `null` while the statuses are loading or could
 * not be loaded. The notice is advisory: without the statuses the athlete can
 * still start a new season, and the server still refuses to plan without both
 * integrations.
 */
function advisorySetupNotice(statuses: IntegrationStatuses): string | null {
  if (
    statuses.loading ||
    statuses.error !== null ||
    statuses.garmin === null ||
    statuses.llm === null
  ) {
    return null;
  }
  return seasonSetupNotice({
    garminConnected: statuses.garmin.connected,
    llmConfigured: statuses.llm.configured,
  });
}

/**
 * Explicit plan regeneration actions. "Plan a new season" starts over from
 * today; "Update season plan" keeps the completed part of the stored season and
 * re-plans the rest. The second action is only offered when there is a season
 * containing today.
 *
 * The generation itself runs in `PlanGenerationProvider`, so the header
 * spinner keeps showing it after the athlete leaves this page.
 */
export function PlanRegenerationButtons() {
  const auth = useAuth();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const { running, mode, start } = usePlanGeneration();
  const statuses = useStatuses(auth);
  const [hasSeason, setHasSeason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const setupNotice = advisorySetupNotice(statuses);
  const runningAction: PlanAction | null =
    running && (mode === "newSeason" || mode === "updateSeason") ? mode : null;

  const [loadAvailability, abortAvailability] = useAbortableRequest(
    async (signal: AbortSignal): Promise<boolean> => {
      const { today } = getToday(timeZone);
      const response = await fetchCoachPlan(auth, { today }, signal);
      const season = response.plan?.season;
      return (
        season !== undefined &&
        today >= season.startDate &&
        today <= season.endDate
      );
    },
  );

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadAvailability()
      .then(setHasSeason)
      .catch((err: unknown) => {
        // Availability is advisory: without it the athlete can still start a
        // new season, which is always a valid action.
        if (!isAbortError(err)) {
          reportErrorQuietly(err);
        }
      });
    return abortAvailability;
  }, [auth, timeZone, loadAvailability, abortAvailability]);

  async function regenerate(action: PlanAction): Promise<void> {
    setError(null);
    setDone(false);
    const outcome = await start(action);
    if (outcome.status === "done") {
      setDone(true);
      // Both actions leave a season that contains today.
      setHasSeason(true);
      return;
    }
    setError(outcome.error);
  }

  /** Starting a new season needs both integrations; send the athlete to set up. */
  function startNewSeason(): void {
    if (setupNotice !== null) {
      navigate("settings");
      return;
    }
    void regenerate("newSeason");
  }

  return (
    <PlanRegenerationButtonsView
      hasSeason={hasSeason}
      running={runningAction}
      busy={running}
      done={done}
      error={error}
      setupNotice={setupNotice}
      onNewSeason={startNewSeason}
      onUpdateSeason={() => void regenerate("updateSeason")}
    />
  );
}

interface PlanRegenerationButtonsViewProps {
  hasSeason: boolean;
  running: PlanAction | null;
  /** Whether any generation is running, including one started elsewhere. */
  busy?: boolean;
  done: boolean;
  error: string | null;
  setupNotice?: string | null;
  onNewSeason: () => void;
  onUpdateSeason: () => void;
}

/** Pure presentation, so the button availability can be tested directly. */
function PlanRegenerationButtonsView({
  hasSeason,
  running,
  busy = running !== null,
  done,
  error,
  setupNotice = null,
  onNewSeason,
  onUpdateSeason,
}: PlanRegenerationButtonsViewProps) {
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
            variant={entry.primary ? "primary" : "secondary"}
            size="md"
            disabled={busy}
            onClick={entry.onClick}
          >
            {running === entry.action ? "Coach is thinking…" : entry.label}
          </SubmitButton>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {hasSeason
          ? "Updating keeps completed blocks and re-plans the rest of this season. A new season starts today."
          : "A new season starts today."}
      </p>
      {setupNotice && (
        <p className="text-base text-muted-foreground" role="status">
          {setupNotice}
        </p>
      )}
      {done && (
        <p className="text-base text-success" role="status">
          Your plan is up to date.
        </p>
      )}
      {error && <p className="text-base text-destructive">{error}</p>}
    </div>
  );
}
