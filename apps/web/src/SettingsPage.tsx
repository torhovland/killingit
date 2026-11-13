import { useEffect, useMemo, useRef, useState } from "react";
import {
  currentUserSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  type AthleteLocation,
} from "@killingit/shared";
import { useAuth } from "./auth";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { DietSection } from "./DietSection";
import { requestParsed } from "./fetchAuthed";
import { GarminSection } from "./GarminSection";
import { LlmSection } from "./LlmSection";
import { LocationSection } from "./LocationSection";
import { PlanRegenerationButtons } from "./PlanRegenerationButtons";
import { usePwa } from "./PwaContext";
import { PwaInstallSection } from "./PwaInstall";
import { reportError } from "./reportError";
import { TimeZoneSection } from "./TimeZoneSection";
import { useApiResources } from "./useApiResource";
import { Button } from "./components/Button";
import { Card } from "./components/Card";

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
  location,
  onLocationChanged,
  dietAdvice,
  onDietAdviceChanged,
  isAdmin,
}: {
  timeZone: string | null;
  onTimeZoneChanged: (timeZone: string | null) => void;
  location: AthleteLocation | null;
  onLocationChanged: (location: AthleteLocation | null) => void;
  dietAdvice: boolean;
  onDietAdviceChanged: (enabled: boolean) => void;
  isAdmin: boolean;
}) {
  const auth = useAuth();
  const pwa = usePwa();
  const statuses = useApiResources(
    auth.isAuthenticated
      ? {
          garmin: {
            path: `${API_URL}/api/garmin/status`,
            schema: garminConnectionStatusSchema,
            action: "Loading the Garmin status",
          },
          llm: {
            path: `${API_URL}/api/llm/settings`,
            schema: llmSettingsSchema,
            action: "Loading the LLM settings",
          },
        }
      : null,
    { statusSource: "settings-page" },
  );
  const garmin = statuses.data?.garmin ?? null;
  const llm = statuses.data?.llm ?? null;
  const loading = statuses.loading;
  const error = statuses.error;
  const [selectedTimeZone, setSelectedTimeZone] = useState(timeZone ?? "");
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null);
  const timeZoneRequest = useRef(0);
  const timeZoneOptions = useMemo(() => {
    const zones = supportedTimeZones();
    return timeZone && !zones.includes(timeZone) ? [timeZone, ...zones] : zones;
  }, [timeZone]);

  useEffect(() => {
    setSelectedTimeZone(timeZone ?? "");
  }, [timeZone]);

  async function saveTimeZone(nextTimeZone: string): Promise<void> {
    const request = ++timeZoneRequest.current;
    setSavingTimeZone(true);
    setTimeZoneError(null);
    try {
      const response = await requestParsed(
        `${API_URL}/api/me`,
        auth,
        currentUserSchema,
        "Saving the time zone",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timezone: nextTimeZone === "" ? null : nextTimeZone,
          }),
        },
      );
      if (request === timeZoneRequest.current) {
        onTimeZoneChanged(response.timezone);
      }
    } catch (err: unknown) {
      if (request === timeZoneRequest.current) {
        setTimeZoneError(reportError(err));
      }
    } finally {
      if (request === timeZoneRequest.current) {
        setSavingTimeZone(false);
      }
    }
  }

  function changeTimeZone(nextTimeZone: string): void {
    setSelectedTimeZone(nextTimeZone);
    void saveTimeZone(nextTimeZone);
  }

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section
      className="flex w-full flex-col gap-6 text-left"
      data-testid="settings-page"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold">Settings</h2>
        <p className="text-base text-muted-foreground">
          Connect your training data, set your location, choose the coach's
          season and day-to-day models, enable diet advice, and rebuild your
          plan.
        </p>
      </div>

      {error && <p className="text-destructive">Error: {error}</p>}

      {loading && (garmin === null || llm === null) ? (
        <p className="text-base text-muted-foreground">Loading settings…</p>
      ) : garmin === null || llm === null ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="self-start"
          onClick={statuses.reload}
        >
          Retry
        </Button>
      ) : (
        <>
          <TimeZoneSection
            selected={selectedTimeZone}
            options={timeZoneOptions}
            saving={savingTimeZone}
            error={timeZoneError}
            onChange={changeTimeZone}
          />

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">Location</h3>
            <p className="text-base text-muted-foreground">
              Choose the place the coach should use for weather and daylight.
              Plans use Open-Meteo and Yr.no forecasts to schedule outdoor
              sessions around rain, wind, cold, sunrise, and sunset.
            </p>
            <LocationSection
              location={location}
              onChanged={onLocationChanged}
            />
          </Card>

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">Diet</h3>
            <DietSection enabled={dietAdvice} onChanged={onDietAdviceChanged} />
          </Card>

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">Garmin</h3>
            <GarminSection
              connected={garmin.connected}
              onConnected={(connected) =>
                statuses.setData((previous) =>
                  previous === null
                    ? previous
                    : { ...previous, garmin: connected },
                )
              }
            />
          </Card>

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">OpenRouter</h3>
            <LlmSection
              settings={llm}
              onSaved={(saved) =>
                statuses.setData((previous) =>
                  previous === null ? previous : { ...previous, llm: saved },
                )
              }
              isAdmin={isAdmin}
            />
          </Card>

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">Training plan</h3>
            <p className="text-base text-muted-foreground">
              Start a new season from today, or keep the completed part of the
              current season and re-plan the rest.
            </p>
            <PlanRegenerationButtons />
          </Card>
        </>
      )}

      <PwaInstallSection
        installed={pwa.installed}
        installable={pwa.installable}
        onInstall={() => void pwa.install()}
      />

      <Card as="section" className="flex flex-col gap-3">
        <h3 className="text-2xl font-semibold">Licence</h3>
        <p className="text-base text-muted-foreground">
          Killing It is source-available under the PolyForm Noncommercial
          License 1.0.0. Commercial use is not permitted.
        </p>
        <a
          className="text-base text-muted-foreground hover:underline"
          href="/third-party-licenses.txt"
        >
          Third-party licences
        </a>
      </Card>

      <DeleteAccountSection />
    </section>
  );
}
