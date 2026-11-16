import { useCallback, useState } from "react";
import type { AuthState } from "./auth";
import { saveBlob } from "./download";
import { fetchFileAuthed } from "./fetchAuthed";
import { reportError } from "./reportError";

export interface PlanWorkoutDownloadState {
  /** The date whose workout file is being prepared, if any. */
  downloadingDate: string | null;
  /** The last failed download, shown with the plan's errors. */
  error: string | null;
  /** Starts a download of the structured workout for a date. */
  downloadWorkout: (date: string) => void;
}

/**
 * Fetches a plan workout file, hands it to the browser, and tracks the date in
 * flight and the last failure. The plan card decides when the button applies,
 * so this hook owns only the download's request and state.
 */
export function usePlanWorkoutDownload(
  auth: AuthState,
): PlanWorkoutDownloadState {
  const [downloadingDate, setDownloadingDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadWorkout = useCallback(
    (date: string) => {
      setDownloadingDate(date);
      setError(null);
      void fetchFileAuthed(`/api/coaching/plan/workouts/${date}`, auth)
        .then(({ blob, filename }) => {
          saveBlob(blob, filename ?? `${date}-workout.zwo`);
        })
        .catch((err: unknown) => {
          setError(reportError(err));
        })
        .finally(() => {
          setDownloadingDate(null);
        });
    },
    [auth],
  );

  return { downloadingDate, error, downloadWorkout };
}
