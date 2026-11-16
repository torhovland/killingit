import { useState } from "react";
import {
  foodEntrySchema,
  type FoodEntry,
  type FoodEntryUpdateRequest,
} from "@killingit/shared";
import { useBusyReporter } from "../AppStatus";
import { useAuth } from "../auth";
import { requestParsed } from "../fetchAuthed";
import { FoodPhoto } from "./FoodPhoto";
import { MealPhotoControls } from "./MealPhotoControls";
import { useMealPhoto } from "./useMealPhoto";
import { reportError } from "../reportError";
import { SubmitButton } from "../SubmitButton";
import { useTimeZone } from "../TimeZoneContext";
import { toWallClockValue, wallClockToIso } from "../timeZone";
import { getToday } from "../useToday";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";

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

  const [eatenAt, setEatenAt] = useState(() =>
    toWallClockValue(new Date(entry.eatenAt), timeZone),
  );
  const [description, setDescription] = useState(entry.description ?? "");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = useMealPhoto({
    setError,
    onPhotoChosen: () => setRemovePhoto(false),
  });

  const willHavePhoto =
    photo.photoDataUrl !== null || (entry.hasPhoto && !removePhoto);
  const canSubmit =
    (description.trim() !== "" || willHavePhoto) &&
    !photo.preparingPhoto &&
    !submitting;

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
        ...(photo.photoDataUrl !== null
          ? { photoDataUrl: photo.photoDataUrl }
          : removePhoto
            ? { removePhoto: true }
            : {}),
      };
      const parsed = await requestParsed(
        `/api/diet/entries/${entry.id}`,
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
    <Card
      as="section"
      className="flex flex-col gap-3 text-left"
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
          <Textarea
            className="font-normal"
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
          <Input
            id="edit-meal-eaten-at"
            type="datetime-local"
            size="inline"
            value={eatenAt}
            onChange={(event) => setEatenAt(event.target.value)}
          />
        </div>

        <MealPhotoControls
          photo={photo}
          cameraTestId="edit-meal-photo-camera"
          uploadTestId="edit-meal-photo-upload"
        >
          {photo.photoDataUrl !== null ? (
            <>
              <img
                src={photo.photoDataUrl}
                alt="The replacement meal"
                className="h-16 w-16 rounded object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="text-sm"
                onClick={photo.clearPhoto}
              >
                Remove new photo
              </Button>
            </>
          ) : entry.hasPhoto && !removePhoto ? (
            <>
              <FoodPhoto
                entryId={entry.id}
                version={entry.updatedAt}
                alt="The meal you attached"
                className="h-16 w-16 rounded object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="text-sm"
                onClick={() => setRemovePhoto(true)}
              >
                Remove photo
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              No photo attached.
            </span>
          )}
        </MealPhotoControls>

        {!canSubmit && !submitting && !photo.preparingPhoto && (
          <p className="text-sm text-muted-foreground">
            Describe the meal or keep a photo before saving.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <SubmitButton
            busy={submitting}
            variant="primary"
            size="md"
            disabled={!canSubmit}
          >
            {submitting ? "Coach is thinking…" : "Save and re-assess"}
          </SubmitButton>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </form>

      {error && (
        <p className="text-destructive" data-testid="edit-food-entry-error">
          Error: {error}
        </p>
      )}
    </Card>
  );
}
