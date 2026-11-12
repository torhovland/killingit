import { useCallback, useEffect, useState } from "react";
import {
  coachingInputSaveResponseSchema,
  manualActivitiesResponseSchema,
  type ManualActivity,
} from "@killingit/shared";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { getToday } from "./useToday";
import { coachingDateQuery } from "./useActivityFeed";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface ManualActivitiesState {
  activities: ManualActivity[];
  error: string | null;
  /** The activity being edited, or null when adding a new one. */
  editing: ManualActivity | null;
  startDate: string;
  details: string;
  saving: boolean;
  setStartDate: (value: string) => void;
  setDetails: (value: string) => void;
  submit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  edit: (activity: ManualActivity) => void;
  cancelEdit: () => void;
  remove: (activity: ManualActivity) => Promise<void>;
}

/**
 * Loads the athlete's manual activities and owns the add/edit form state. A
 * save or delete asks the caller to reload the activity feed, because a manual
 * entry changes the day's training load.
 */
export function useManualActivities(
  auth: AuthState,
  timeZone: string,
  onChanged?: () => Promise<void>,
): ManualActivitiesState {
  const [activities, setActivities] = useState<ManualActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManualActivity | null>(null);
  const [startDate, setStartDate] = useState(() => getToday(timeZone).today);
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await requestParsed(
        `${API_URL}/api/coaching/activities/manual`,
        auth,
        manualActivitiesResponseSchema,
        "Loading manual activities",
      );
      setActivities(response.manualActivities);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }, [auth]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void load();
  }, [auth, load]);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (!startDate || !details.trim() || saving) {
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const { today } = getToday(timeZone);
        const path =
          editing === null
            ? `${API_URL}/api/coaching/activities/manual`
            : `${API_URL}/api/coaching/activities/manual/${editing.id}`;
        await requestParsed(
          path,
          auth,
          coachingInputSaveResponseSchema,
          editing === null
            ? "Saving the manual activity"
            : "Updating the manual activity",
          {
            method: editing === null ? "POST" : "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              today,
              timezone: timeZone,
              startDate,
              details,
            }),
          },
        );
        setEditing(null);
        setStartDate(getToday(timeZone).today);
        setDetails("");
        await Promise.all([load(), onChanged?.()]);
      } catch (err: unknown) {
        setError(reportError(err));
      } finally {
        setSaving(false);
      }
    },
    [auth, timeZone, editing, startDate, details, saving, load, onChanged],
  );

  const edit = useCallback((activity: ManualActivity): void => {
    setEditing(activity);
    setStartDate(activity.startDate);
    setDetails(activity.details);
  }, []);

  const cancelEdit = useCallback((): void => {
    setEditing(null);
    setStartDate(getToday(timeZone).today);
    setDetails("");
  }, [timeZone]);

  const remove = useCallback(
    async (activity: ManualActivity): Promise<void> => {
      if (
        !window.confirm(
          `Delete the manual activity from ${activity.startDate}?`,
        )
      ) {
        return;
      }
      const editingDeleted = editing?.id === activity.id;
      setError(null);
      try {
        await requestParsed(
          `${API_URL}/api/coaching/activities/manual/${activity.id}?${coachingDateQuery(timeZone)}`,
          auth,
          coachingInputSaveResponseSchema,
          "Deleting the manual activity",
          { method: "DELETE" },
        );
        if (editingDeleted) {
          setEditing(null);
          setStartDate(getToday(timeZone).today);
          setDetails("");
        }
        await Promise.all([load(), onChanged?.()]);
      } catch (err: unknown) {
        setError(reportError(err));
      }
    },
    [auth, timeZone, editing, load, onChanged],
  );

  return {
    activities,
    error,
    editing,
    startDate,
    details,
    saving,
    setStartDate,
    setDetails,
    submit,
    edit,
    cancelEdit,
    remove,
  };
}
