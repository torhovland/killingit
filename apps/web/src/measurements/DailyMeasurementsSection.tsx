import { useState } from "react";
import {
  BODY_MEASUREMENTS,
  dailyMeasurementSaveResponseSchema,
  dailyMeasurementsResponseSchema,
  type BodyMeasurementKey,
  type DailyMeasurementSaveRequest,
} from "@killingit/shared";
import { useBusyReporter } from "../AppStatus";
import { useAuth } from "../auth";
import { requestParsed } from "../fetchAuthed";
import { reportError } from "../reportError";
import { SubmitButton } from "../SubmitButton";
import { useTimeZone } from "../TimeZoneContext";
import { getToday } from "../useToday";
import { useApiResource } from "../useApiResource";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";

/** A blank value for every measurement the panel can show. */
function emptyValues(): Record<BodyMeasurementKey, string> {
  return { weight: "", bodyFat: "" };
}

/** A typed measurement, or null when the field is blank. */
function measurementValue(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The daily body-measurement entry panel. It is shared by the dashboard and the
 * Diet page and stays hidden when the athlete tracks no measure the Body chart
 * draws. Saving replaces the selected day's value and shows a plain confirmation
 * without asking the coach for a comment.
 */
export function DailyMeasurementsSection() {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const reportSave = useBusyReporter("daily-measurements");
  const resource = useApiResource(
    "/api/measurements",
    dailyMeasurementsResponseSchema,
    "Loading your measurements",
  );
  const [date, setDate] = useState(() => getToday(timeZone).today);
  const [values, setValues] =
    useState<Record<BodyMeasurementKey, string>>(emptyValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (resource.error !== null && resource.data === null) {
    return (
      <Card
        as="section"
        className="flex flex-col gap-2"
        data-testid="daily-measurements-error"
      >
        <p className="text-destructive">Error: {resource.error}</p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="self-start"
          onClick={resource.reload}
        >
          Retry
        </Button>
      </Card>
    );
  }
  if (resource.data === null || resource.data.metrics.length === 0) {
    return null;
  }
  const metrics = resource.data.metrics;

  function changeDate(next: string): void {
    setDate(next);
    setValues(emptyValues());
    setSaved(false);
    setError(null);
  }

  function changeValue(key: BodyMeasurementKey, next: string): void {
    setValues((current) => ({ ...current, [key]: next }));
    setSaved(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: DailyMeasurementSaveRequest = { date };
    for (const key of metrics) {
      const value = measurementValue(values[key]);
      if (value === null) {
        continue;
      }
      if (key === "weight") {
        input.weightKg = value;
      } else {
        input.bodyFatPercent = value;
      }
    }
    if (input.weightKg == null && input.bodyFatPercent == null) {
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    reportSave(true);
    try {
      await requestParsed(
        "/api/measurements",
        auth,
        dailyMeasurementSaveResponseSchema,
        "Logging your measurements",
        { method: "PUT", json: input },
      );
      setSaved(true);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
      reportSave(false);
    }
  }

  return (
    <Card
      as="section"
      className="flex flex-col gap-3 text-left"
      data-testid="daily-measurements"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Daily measurements</h2>
        <p className="text-base text-muted-foreground">
          Enter the numbers you track on the Body chart.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-1 text-base font-medium">
          Date
          <Input
            type="date"
            size="inline"
            max={getToday(timeZone).today}
            value={date}
            onChange={(event) => changeDate(event.target.value)}
            data-testid="daily-measurements-date"
          />
        </label>

        <div className="flex flex-wrap gap-3">
          {metrics.map((key) => (
            <label
              key={key}
              className="flex flex-col gap-1 text-base font-medium"
            >
              {BODY_MEASUREMENTS[key].label} ({BODY_MEASUREMENTS[key].unit})
              <Input
                type="number"
                size="inline"
                inputMode="decimal"
                step="any"
                min="0.1"
                max={BODY_MEASUREMENTS[key].max}
                value={values[key]}
                onChange={(event) => changeValue(key, event.target.value)}
                data-testid={`daily-measurements-${key}`}
              />
            </label>
          ))}
        </div>

        <SubmitButton
          busy={saving}
          variant="primary"
          size="md"
          className="self-start"
        >
          {saving ? "Saving…" : "Log measurements"}
        </SubmitButton>
      </form>

      {error !== null && (
        <p
          className="text-destructive"
          data-testid="daily-measurements-save-error"
        >
          Error: {error}
        </p>
      )}

      {saved && (
        <p
          className="text-base font-medium"
          role="status"
          data-testid="daily-measurements-saved"
        >
          Measurements saved.
        </p>
      )}
    </Card>
  );
}
