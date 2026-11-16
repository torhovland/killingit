import type { ChangeEvent, ReactNode } from "react";
import { Button } from "../components/Button";
import { HiddenFileInput } from "../components/HiddenFileInput";
import type { MealPhoto } from "./useMealPhoto";

/**
 * The camera and upload pickers shared by the meal forms, with the
 * preparation line and the chosen file's name. Each form renders its own
 * preview as `children`, because editing a meal also previews and removes the
 * stored photo.
 */
export function MealPhotoControls({
  photo,
  cameraTestId,
  uploadTestId,
  children,
}: {
  photo: MealPhoto;
  cameraTestId: string;
  uploadTestId: string;
  /** The form's own preview of the new or stored photo. */
  children: ReactNode;
}) {
  function prepare(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    void photo.choosePhoto(file);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <HiddenFileInput
        ref={photo.cameraInput}
        accept="image/*"
        capture="environment"
        data-testid={cameraTestId}
        onChange={prepare}
      />
      <HiddenFileInput
        ref={photo.uploadInput}
        accept="image/*"
        data-testid={uploadTestId}
        onChange={prepare}
      />
      {children}
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={photo.preparingPhoto}
        onClick={() => photo.cameraInput.current?.click()}
      >
        Take photo
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={photo.preparingPhoto}
        onClick={() => photo.uploadInput.current?.click()}
      >
        Upload image
      </Button>
      {photo.preparingPhoto && (
        <span className="text-sm text-muted-foreground">Preparing photo…</span>
      )}
      {photo.photoName !== null && photo.photoDataUrl !== null && (
        <span className="max-w-48 truncate text-sm text-muted-foreground">
          {photo.photoName}
        </span>
      )}
    </div>
  );
}
