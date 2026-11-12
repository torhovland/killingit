import { useEffect, useState } from "react";
import {
  coachPlanResponseSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type PlanGenerateMode,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { useNavigate } from "./navigation";
import { usePlanGeneration } from "./PlanGenerationProvider";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type PlanAction = Extract<PlanGenerateMode, "newSeason" | "updateSeason">;

interface IntegrationSetup {
  garminConnected: boolean;
  llmConfigured: boolean;
}

/**
 * The setup the athlete still needs before a new season can be planned, or
 * `null` when Garmin and OpenRouter are both ready.
 */
export function seasonSetupNotice({
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
  const [hasSeason, setHasSeason] = useState(false);
  const [setup, setSetup] = useState<IntegrationSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const setupNotice = setup === null ? null : seasonSetupNotice(setup);
  const runningAction: PlanAction | null =
    running && (mode === "newSeason" || mode === "updateSeason") ? mode : null;

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;

    async function loadAvailability(): Promise<void> {
      try {
        const { today } = getToday(timeZone);
        const response = await requestParsed(
          `${API_URL}/api/coaching/plan?today=${today}`,
          auth,
          coachPlanResponseSchema,
          "Loading your plan",
        );
        if (cancelled) {
          return;
        }
        const season = response.plan?.season;
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
  }, [auth, timeZone]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    let cancelled = false;

    async function loadSetup(): Promise<void> {
      try {
        const [garmin, llm] = await Promise.all([
          requestParsed(
            `${API_URL}/api/garmin/status`,
            auth,
            garminConnectionStatusSchema,
            "Loading the Garmin status",
          ),
          requestParsed(
            `${API_URL}/api/llm/settings`,
            auth,
            llmSettingsSchema,
            "Loading the LLM settings",
          ),
        ]);
        if (cancelled) {
          return;
        }
        setSetup({
          garminConnected: garmin.connected,
          llmConfigured: llm.configured,
        });
      } catch (err: unknown) {
        // Without the setup status we cannot gate the action; the server still
        // refuses to plan without both integrations.
        console.error("Failed to check Garmin and OpenRouter setup:", err);
      }
    }

    void loadSetup();
    return () => {
      cancelled = true;
    };
  }, [auth]);

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
export function PlanRegenerationButtonsView({
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
