import { useRef, useState } from "react";
import {
  foodEntrySchema,
  type FoodEntry,
  type FoodEntryUpdateRequest,
} from "@killingit/shared";
import { useBusyReporter } from "./AppStatus";
import { useAuth } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { FoodPhoto } from "./FoodPhoto";
import { prepareMealPhoto } from "./imageUpload";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { toWallClockValue, wallClockToIso } from "./timeZone";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Edits one logged meal and asks the coach to re-assess it. The stored photo is
 * only a thumbnail, so an edit without a new photo re-analyses that thumbnail;
 * replacing it sends the new full-resolution image.
 */
export function EditFoodEntryForm({
  entry,
  onSaved,
  onCancel,
}: {
  entry: FoodEntry;
  onSaved: (entry: FoodEntry) => void;
  onCancel: () => void;
}) {
  const auth = useAuth();
  const timeZone = useTimeZone();
  const reportSave = useBusyReporter("food-entry-edit");
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const [eatenAt, setEatenAt] = useState(() =>
    toWallClockValue(new Date(entry.eatenAt), timeZone),
  );
  const [description, setDescription] = useState(entry.description ?? "");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const willHavePhoto =
    photoDataUrl !== null || (entry.hasPhoto && !removePhoto);
  const canSubmit =
    (description.trim() !== "" || willHavePhoto) &&
    !preparingPhoto &&
    !submitting;

  async function choosePhoto(file: File | undefined): Promise<void> {
    if (file === undefined) {
      return;
    }
    setPreparingPhoto(true);
    setError(null);
    try {
      setPhotoDataUrl(await prepareMealPhoto(file));
      setPhotoName(file.name);
      setRemovePhoto(false);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    reportSave(true);
    try {
      const { today } = getToday(timeZone);
      const body: FoodEntryUpdateRequest = {
        eatenAt: wallClockToIso(eatenAt, timeZone),
        timezone: timeZone,
        today,
        description: description.trim() || null,
        ...(photoDataUrl !== null
          ? { photoDataUrl }
          : removePhoto
            ? { removePhoto: true }
            : {}),
      };
      const parsed = await requestParsed(
        `${API_URL}/api/diet/entries/${entry.id}`,
        auth,
        foodEntrySchema,
        "Editing the meal",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      onSaved(parsed);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSubmitting(false);
      reportSave(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-left"
      data-testid="edit-food-entry"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">Edit this meal</h3>
        <p className="text-base text-muted-foreground">
          Saving your changes asks your coach to analyse the meal again.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-1 text-base font-medium">
          What did you eat? (optional with a photo)
          <textarea
            className="w-full rounded border bg-card p-2 text-base font-normal"
            rows={4}
            value={description}
            placeholder="e.g. Two slices of wholegrain toast with peanut butter and a banana"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1">
          <label className="text-base font-medium" htmlFor="edit-meal-eaten-at">
            When did you eat it?
          </label>
          <input
            id="edit-meal-eaten-at"
            type="datetime-local"
            className="rounded border bg-card p-2 text-base"
            value={eatenAt}
            onChange={(event) => setEatenAt(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            data-testid="edit-meal-photo-camera"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void choosePhoto(file);
            }}
          />
          <input
            ref={uploadInput}
            type="file"
            accept="image/*"
            className="sr-only"
            data-testid="edit-meal-photo-upload"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void choosePhoto(file);
            }}
          />
          {photoDataUrl !== null ? (
            <>
              <img
                src={photoDataUrl}
                alt="The replacement meal photo"
                className="h-16 w-16 rounded object-cover"
              />
              <button
                type="button"
                className="rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted"
                onClick={() => {
                  setPhotoDataUrl(null);
                  setPhotoName(null);
                }}
              >
                Remove new photo
              </button>
            </>
          ) : entry.hasPhoto && !removePhoto ? (
            <>
              <FoodPhoto
                entryId={entry.id}
                version={entry.updatedAt}
                alt="The meal photo you attached"
                className="h-16 w-16 rounded object-cover"
              />
              <button
                type="button"
                className="rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted"
                onClick={() => setRemovePhoto(true)}
              >
                Remove photo
              </button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              No photo attached.
            </span>
          )}
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
            disabled={preparingPhoto}
            onClick={() => cameraInput.current?.click()}
          >
            Take photo
          </button>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
            disabled={preparingPhoto}
            onClick={() => uploadInput.current?.click()}
          >
            Upload image
          </button>
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

        {!canSubmit && !submitting && !preparingPhoto && (
          <p className="text-sm text-muted-foreground">
            Describe the meal or keep a photo before saving.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <SubmitButton
            busy={submitting}
            className="rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={!canSubmit}
          >
            {submitting ? "Coach is thinking…" : "Save and re-assess"}
          </SubmitButton>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>

      {error && (
        <p className="text-destructive" data-testid="edit-food-entry-error">
          Error: {error}
        </p>
      )}
    </section>
  );
}
