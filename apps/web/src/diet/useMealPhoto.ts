import { useRef, useState, type RefObject } from "react";
import { prepareMealPhoto } from "../imageUpload";
import { reportError } from "../reportError";

/** The photo a meal form has prepared, plus the pickers that feed it. */
export interface MealPhoto {
  photoDataUrl: string | null;
  photoName: string | null;
  preparingPhoto: boolean;
  cameraInput: RefObject<HTMLInputElement | null>;
  uploadInput: RefObject<HTMLInputElement | null>;
  choosePhoto: (file: File | undefined) => Promise<void>;
  clearPhoto: () => void;
}

/**
 * Prepares a camera or gallery image for a meal form. Logging and editing a
 * meal share the two hidden pickers, the preparation and the chosen file's
 * name; each form keeps its own error paragraph and preview, so a failure is
 * reported through the form's `setError`.
 */
export function useMealPhoto({
  setError,
  onPhotoChosen,
}: {
  setError: (message: string | null) => void;
  /** Called once a new photo is ready, e.g. to undo an earlier removal. */
  onPhotoChosen?: () => void;
}): MealPhoto {
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);

  async function choosePhoto(file: File | undefined): Promise<void> {
    if (file === undefined) {
      return;
    }
    setPreparingPhoto(true);
    setError(null);
    try {
      setPhotoDataUrl(await prepareMealPhoto(file));
      setPhotoName(file.name);
      onPhotoChosen?.();
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setPreparingPhoto(false);
    }
  }

  function clearPhoto(): void {
    setPhotoDataUrl(null);
    setPhotoName(null);
  }

  return {
    photoDataUrl,
    photoName,
    preparingPhoto,
    cameraInput,
    uploadInput,
    choosePhoto,
    clearPhoto,
  };
}
