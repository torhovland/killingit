import { useCallback, useEffect, useState } from "react";
import {
  coachingInputSaveResponseSchema,
  weeklyNoteResponseSchema,
  type CoachAnalysis,
} from "@killingit/shared";
import { useBusyReporter } from "./AppStatus";
import type { AuthState } from "./auth";
import { requestParsed } from "./fetchAuthed";
import { reportError } from "./reportError";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface WeeklyNoteState {
  note: string;
  reply: CoachAnalysis | null;
  saving: boolean;
  error: string | null;
  setNote: (value: string) => void;
  submit: () => Promise<void>;
}

/**
 * Loads the current week's note and saves a new one. A failed load only logs:
 * the dashboard must still render when the note endpoint is unavailable.
 */
export function useWeeklyNote(
  auth: AuthState,
  timeZone: string,
  onSaved?: () => void,
): WeeklyNoteState {
  const reportSave = useBusyReporter("weekly-note-save");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState<CoachAnalysis | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    async function load(): Promise<void> {
      try {
        const { today } = getToday(timeZone);
        const response = await requestParsed(
          `${API_URL}/api/coaching/weekly/notes?today=${today}`,
          auth,
          weeklyNoteResponseSchema,
          "Loading the weekly note",
        );
        setNote(response.note ?? "");
        setReply(response.reply);
      } catch (err: unknown) {
        // Don't block the dashboard if the note fails to load.
        console.error("Failed to load weekly note:", err);
      }
    }
    void load();
  }, [auth, timeZone]);

  const submit = useCallback(async (): Promise<void> => {
    if (!note.trim() || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    reportSave(true);
    try {
      const { today } = getToday(timeZone);
      const response = await requestParsed(
        `${API_URL}/api/coaching/weekly/notes`,
        auth,
        coachingInputSaveResponseSchema,
        "Saving your note",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone: timeZone,
            note,
          }),
        },
      );
      setReply(response.reply);
      onSaved?.();
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSaving(false);
      reportSave(false);
    }
  }, [auth, timeZone, note, saving, reportSave, onSaved]);

  return { note, reply, saving, error, setNote, submit };
}
