import { useRef, useState } from "react";
import { foodEntrySchema, type FoodEntry } from "@killingit/shared";
import { useBusyReporter } from "./AppStatus";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { FoodEntryCard } from "./FoodEntryCard";
import { prepareMealPhoto } from "./imageUpload";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { toWallClockValue, wallClockToIso } from "./timeZone";
import { getToday } from "./useToday";
import { Button } from "./components/Button";
import { Card } from "./components/Card";
import { HiddenFileInput } from "./components/HiddenFileInput";
import { Input } from "./components/Input";
import { Textarea } from "./components/Textarea";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * The food log form at the top of the dashboard. It is only mounted when the
 * athlete has enabled diet advice in Settings, so the opt-in gates both the
 * form and the prompt context.
 */
export function FoodLogSection({
  enabled,
  onLogged,
}: {
  enabled: boolean;
  /** Called after a meal is saved, so the caller can refresh its summaries. */
  onLogged?: (entry: FoodEntry) => void;
}) {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const reportSave = useBusyReporter("food-log");
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const [eatenAt, setEatenAt] = useState(() =>
    toWallClockValue(new Date(), timeZone),
  );
  const [description, setDescription] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FoodEntry | null>(null);

  if (!enabled) {
    return null;
  }

  async function choosePhoto(file: File | undefined): Promise<void> {
    if (file === undefined) {
      return;
    }
    setPreparingPhoto(true);
    setError(null);
    try {
      setPhotoDataUrl(await prepareMealPhoto(file));
      setPhotoName(file.name);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      (!description.trim() && photoDataUrl === null) ||
      submitting ||
      preparingPhoto
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    reportSave(true);
    try {
      const { today } = getToday(timeZone);
      const parsed = await requestParsed(
        `${API_URL}/api/diet/entries`,
        auth,
        foodEntrySchema,
        "Logging the meal",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eatenAt: wallClockToIso(eatenAt, timeZone),
            timezone: timeZone,
            today,
            description: description.trim() || null,
            photoDataUrl,
          }),
        },
      );
      setResult(parsed);
      onLogged?.(parsed);
      setDescription("");
      setPhotoDataUrl(null);
      setPhotoName(null);
      setEatenAt(toWallClockValue(new Date(), timeZone));
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSubmitting(false);
      reportSave(false);
    }
  }

  return (
    <Card
      as="section"
      className="flex flex-col gap-3 text-left"
      data-testid="food-log"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Log a meal</h2>
        <p className="text-base text-muted-foreground">
          Describe what you ate, or just add a photo, and your coach will
          estimate the carbs and macros and tell you how it fits your diet.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-1 text-base font-medium">
          What did you eat? (optional with a photo)
          <Textarea
            className="font-normal"
            rows={4}
            value={description}
            placeholder="e.g. Two slices of wholegrain toast with peanut butter and a banana"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1">
          <label className="text-base font-medium" htmlFor="meal-eaten-at">
            When did you eat it?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="meal-eaten-at"
              type="datetime-local"
              size="inline"
              value={eatenAt}
              onChange={(event) => setEatenAt(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="text-sm"
              onClick={() => setEatenAt(toWallClockValue(new Date(), timeZone))}
            >
              Now
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <HiddenFileInput
            ref={cameraInput}
            accept="image/*"
            capture="environment"
            data-testid="meal-photo-camera"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void choosePhoto(file);
            }}
          />
          <HiddenFileInput
            ref={uploadInput}
            accept="image/*"
            data-testid="meal-photo-upload"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void choosePhoto(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={preparingPhoto}
            onClick={() => cameraInput.current?.click()}
          >
            Take photo
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={preparingPhoto}
            onClick={() => uploadInput.current?.click()}
          >
            Upload image
          </Button>
          {photoDataUrl !== null && (
            <>
              <img
                src={photoDataUrl}
                alt="The meal photo you attached"
                className="h-16 w-16 rounded object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="text-sm"
                onClick={() => {
                  setPhotoDataUrl(null);
                  setPhotoName(null);
                }}
              >
                Remove photo
              </Button>
            </>
          )}
          {preparingPhoto && (
            <span className="text-sm text-muted-foreground">
              Preparing photo…
            </span>
          )}
          {photoName !== null && photoDataUrl !== null && (
            <span className="max-w-48 truncate text-sm text-muted-foreground">
              {photoName}
            </span>
          )}
        </div>

        <SubmitButton
          busy={submitting}
          variant="primary"
          size="md"
          className="self-start"
          disabled={
            (!description.trim() && photoDataUrl === null) || preparingPhoto
          }
        >
          {submitting ? "Coach is thinking…" : "Log meal"}
        </SubmitButton>
      </form>

      {error && (
        <p className="text-destructive" data-testid="food-log-error">
          Error: {error}
        </p>
      )}

      {result !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium">Logged. Your coach said:</p>
          <FoodEntryCard entry={result} compact />
        </div>
      )}
    </Card>
  );
}
