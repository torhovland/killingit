import { useEffect, useMemo, useState } from "react";
import {
  currentUserSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type GarminConnectionStatus,
  type LlmSettings,
} from "@killingit/shared";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { GarminSection } from "./GarminSection";
import { LlmSection } from "./LlmSection";
import { RegeneratePlanButton } from "./RegeneratePlanButton";
import { reportError } from "./reportError";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** The runtime's IANA zones, with a safe fallback for older browsers. */
function supportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  return intl.supportedValuesOf?.("timeZone") ?? [];
}

/** Account settings: Garmin, OpenRouter, time zone, and plan regeneration. */
export function SettingsPage({
  timeZone,
  onTimeZoneChanged,
}: {
  timeZone: string | null;
  onTimeZoneChanged: (timeZone: string | null) => void;
}) {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const [garmin, setGarmin] = useState<GarminConnectionStatus | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeZone, setSelectedTimeZone] = useState(timeZone ?? "");
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null);
  const timeZoneOptions = useMemo(() => {
    const zones = supportedTimeZones();
    return timeZone && !zones.includes(timeZone) ? [timeZone, ...zones] : zones;
  }, [timeZone]);

  useEffect(() => {
    setSelectedTimeZone(timeZone ?? "");
  }, [timeZone]);

  async function saveTimeZone(): Promise<void> {
    setSavingTimeZone(true);
    setTimeZoneError(null);
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/me`,
        auth,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timezone: selectedTimeZone === "" ? null : selectedTimeZone,
          }),
        },
      );
      const parsed = currentUserSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Saving the time zone returned an unexpected response",
          {
            cause: parsed.error,
          },
        );
      }
      onTimeZoneChanged(parsed.data.timezone);
    } catch (err: unknown) {
      setTimeZoneError(reportError(err));
    } finally {
      setSavingTimeZone(false);
    }
  }

  useEffect(() => {
    setStatus("settings-page", loading ? "loading" : null);
    return () => setStatus("settings-page", null);
  }, [loading, setStatus]);

  async function loadStatuses(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [garminRes, llmRes] = await Promise.all([
        fetchJsonAuthed<unknown>(`${API_URL}/api/garmin/status`, auth),
        fetchJsonAuthed<unknown>(`${API_URL}/api/llm/settings`, auth),
      ]);
      const garminParsed = garminConnectionStatusSchema.safeParse(garminRes);
      const llmParsed = llmSettingsSchema.safeParse(llmRes);
      if (!garminParsed.success || !llmParsed.success) {
        throw new Error("Status endpoints returned an unexpected response");
      }
      setGarmin(garminParsed.data);
      setLlm(llmParsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadStatuses();
  }, [auth.isAuthenticated]);

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section
      className="flex w-full flex-col gap-6 text-left"
      data-testid="settings-page"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Connect your training data, configure the coach's model, and rebuild
          your plan.
        </p>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}

      {loading && (garmin === null || llm === null) ? (
        <p className="text-sm text-muted-foreground">Loading settings…</p>
      ) : garmin === null || llm === null ? (
        <button
          type="button"
          className="self-start rounded border bg-card px-4 py-2 enabled:hover:bg-muted"
          onClick={() => void loadStatuses()}
        >
          Retry
        </button>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <h3 className="text-xl font-semibold">Time zone</h3>
            <p className="text-sm text-muted-foreground">
              Activity times and generated timestamps use this zone. Leave it on
              your device's zone to follow your current location.
            </p>
            <label className="flex max-w-md flex-col gap-1 text-sm">
              <span className="font-medium">Display time zone</span>
              <select
                className="rounded border bg-card px-2 py-1"
                value={selectedTimeZone}
                onChange={(event) => setSelectedTimeZone(event.target.value)}
                disabled={savingTimeZone}
              >
                <option value="">Device time zone</option>
                {timeZoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            {timeZoneError && (
              <p className="text-destructive">{timeZoneError}</p>
            )}
            <button
              type="button"
              className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
              onClick={() => void saveTimeZone()}
              disabled={savingTimeZone || selectedTimeZone === (timeZone ?? "")}
            >
              {savingTimeZone ? "Saving…" : "Save time zone"}
            </button>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <h3 className="text-xl font-semibold">Garmin</h3>
            <GarminSection
              connected={garmin.connected}
              onConnected={setGarmin}
            />
          </section>

          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <h3 className="text-xl font-semibold">OpenRouter</h3>
            <LlmSection settings={llm} onSaved={setLlm} />
          </section>

          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <h3 className="text-xl font-semibold">Training plan</h3>
            <p className="text-sm text-muted-foreground">
              Rebuild the season, block, week, and today from your current
              profile and training.
            </p>
            <RegeneratePlanButton />
          </section>
        </>
      )}
    </section>
  );
}
