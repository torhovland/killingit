import { useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useCurrentUser } from "../CurrentUserProvider";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { DietSection } from "./DietSection";
import { GarminSection } from "./GarminSection";
import { LlmSection } from "./LlmSection";
import { LocationSection } from "./LocationSection";
import { PlanRegenerationButtons } from "../PlanRegenerationButtons";
import { usePwa } from "../PwaContext";
import { PwaInstallSection } from "../PwaInstall";
import { reportError } from "../reportError";
import { TimeZoneSection } from "./TimeZoneSection";
import { usePropDraft } from "../usePropDraft";
import { useStatuses } from "../useStatuses";
import { Button } from "../components/Button";
import { Card } from "../components/Card";

/** The runtime's IANA zones, with a safe fallback for older browsers. */
function supportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  return intl.supportedValuesOf?.("timeZone") ?? [];
}

/** The picker's zone is plain text, so equal strings are the same selection. */
function sameTimeZone(left: string, right: string): boolean {
  return left === right;
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
  const pwa = usePwa();
  const { user, update } = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const { garmin, llm, loading, error, reload, setData } = useStatuses(auth, {
    statusSource: "settings-page",
  });
  const draft = usePropDraft(timeZone ?? "", sameTimeZone);
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null);
  const timeZoneRequest = useRef(0);
  const timeZoneOptions = useMemo(() => {
    const zones = supportedTimeZones();
    return timeZone && !zones.includes(timeZone) ? [timeZone, ...zones] : zones;
  }, [timeZone]);

  async function saveTimeZone(nextTimeZone: string): Promise<void> {
    const request = ++timeZoneRequest.current;
    setSavingTimeZone(true);
    setTimeZoneError(null);
    try {
      const response = await update({
        timezone: nextTimeZone === "" ? null : nextTimeZone,
      });
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
    draft.update(nextTimeZone);
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
          onClick={reload}
        >
          Retry
        </Button>
      ) : (
        <>
          <TimeZoneSection
            selected={draft.value}
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
              location={user?.location ?? null}
              onSave={async (location) => (await update({ location })).location}
            />
          </Card>

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">Diet</h3>
            <DietSection
              enabled={user?.dietAdvice ?? false}
              onSave={async (dietAdvice) => {
                await update({ dietAdvice });
              }}
            />
          </Card>

          <Card as="section" className="flex flex-col gap-3">
            <h3 className="text-2xl font-semibold">Garmin</h3>
            <GarminSection
              connected={garmin.connected}
              onConnected={(connected) =>
                setData((previous) =>
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
                setData((previous) =>
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
