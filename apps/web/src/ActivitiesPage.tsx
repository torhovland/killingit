import { useEffect, useRef, useState } from "react";
import {
  analyzedActivitiesResponseSchema,
  coachingInputSaveResponseSchema,
  garminConnectionStatusSchema,
  llmSettingsSchema,
  manualActivitiesResponseSchema,
  type AnalyzedActivitiesResponse,
  type GarminConnectionStatus,
  type LlmSettings,
  type ManualActivity,
} from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { loadCachedActivities, saveCachedActivities } from "./activityCache";
import { useAppStatus, useBusyReporter } from "./AppStatus";
import { useAuth } from "./auth";
import { fetchJsonAuthed } from "./fetchAuthed";
import { useNavigate } from "./navigation";
import { reportError } from "./reportError";
import { useTimeZone } from "./TimeZoneContext";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * The activities page: every imported activity, the manual activity log, and
 * the sync / re-analyse action.
 */
export function ActivitiesPage() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const reportCommentSave = useBusyReporter("comment-save");
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const authSub = useRef(auth.sub);
  authSub.current = auth.sub;
  const [garmin, setGarmin] = useState<GarminConnectionStatus | null>(null);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [data, setData] = useState<AnalyzedActivitiesResponse | null>(() =>
    loadCachedActivities(auth.sub),
  );
  const [manualActivities, setManualActivities] = useState<ManualActivity[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<number | null>(
    null,
  );
  const [manualStartDate, setManualStartDate] = useState(
    () => getToday(timeZone).today,
  );
  const [manualDetails, setManualDetails] = useState("");

  useEffect(() => {
    setStatus("activities-page", syncing ? "syncing" : null);
    return () => setStatus("activities-page", null);
  }, [syncing, setStatus]);

  async function loadStatuses(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [garminRes, llmRes] = await Promise.all([
        fetchJsonAuthed<unknown>(`${API_URL}/api/garmin/status`, auth),
        fetchJsonAuthed<unknown>(`${API_URL}/api/llm/settings`, auth),
      ]);
      const garminParsed = garminConnectionStatusSchema.safeParse(garminRes);
      const llmParsed = llmSettingsSchema.safeParse(llmRes);
      if (!garminParsed.success || !llmParsed.success) {
        throw new Error("Status endpoints returned an unexpected response");
      }
      setGarmin(garminParsed.data);
      setLlm(llmParsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadAnalyses(refresh = false): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities?limit=20${refresh ? "&refresh=true" : ""}`,
        auth,
      );
      const parsed = analyzedActivitiesResponseSchema.safeParse(res);
      if (!parsed.success) {
        throw new Error("Coaching endpoint returned an unexpected response", {
          cause: parsed.error,
        });
      }
      setData(parsed.data);
      saveCachedActivities(authSub.current, parsed.data);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSyncing(false);
    }
  }

  async function loadManualActivities(): Promise<void> {
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/manual`,
        auth,
      );
      const parsed = manualActivitiesResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error(
          "Loading manual activities returned an unexpected response",
          { cause: parsed.error },
        );
      }
      setManualActivities(parsed.data.manualActivities);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  function coachingDateQuery(): string {
    return new URLSearchParams({
      today: getToday(timeZone).today,
      timezone: timeZone,
    }).toString();
  }

  async function deleteActivity(activityId: string): Promise<void> {
    const response = await fetchJsonAuthed<unknown>(
      `${API_URL}/api/coaching/activities/${activityId}?${coachingDateQuery()}`,
      auth,
      { method: "DELETE" },
    );
    parseSaveResponse(response);
    const next = data
      ? {
          ...data,
          activities: data.activities.filter(
            (activity) => String(activity.id) !== activityId,
          ),
        }
      : null;
    setData(next);
    if (next) {
      saveCachedActivities(authSub.current, next);
    }
  }

  async function submitComment(
    activityId: string,
    comment: string,
    mode: "create" | "edit",
  ): Promise<string | null> {
    reportCommentSave(true);
    try {
      const { today } = getToday(timeZone);
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/${activityId}/comments`,
        auth,
        {
          method: mode === "edit" ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            today,
            timezone: timeZone,
            activityDate: activityStartDate(activityId),
            comment,
          }),
        },
      );
      const parsed = coachingInputSaveResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Saving your comment returned an unexpected response", {
          cause: parsed.error,
        });
      }
      const next = data
        ? {
            ...data,
            activities: data.activities.map((activity) =>
              String(activity.id) === activityId
                ? {
                    ...activity,
                    comment,
                    coachReply: parsed.data.reply ?? activity.coachReply,
                  }
                : activity,
            ),
          }
        : null;
      setData(next);
      if (next) {
        saveCachedActivities(authSub.current, next);
      }
      return parsed.data.reply?.text ?? null;
    } finally {
      reportCommentSave(false);
    }
  }

  function activityStartDate(activityId: string): string {
    const activity = data?.activities.find(
      (entry) => String(entry.id) === activityId,
    );
    return (activity?.startDate ?? getToday(timeZone).today).slice(0, 10);
  }

  async function handleManualActivitySubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!manualStartDate || !manualDetails.trim()) {
      return;
    }
    try {
      const { today } = getToday(timeZone);
      const path =
        editingActivityId === null
          ? `${API_URL}/api/coaching/activities/manual`
          : `${API_URL}/api/coaching/activities/manual/${editingActivityId}`;
      const response = await fetchJsonAuthed<unknown>(path, auth, {
        method: editingActivityId === null ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          today,
          timezone: timeZone,
          startDate: manualStartDate,
          details: manualDetails,
        }),
      });
      parseSaveResponse(response);
      setEditingActivityId(null);
      setManualStartDate(getToday(timeZone).today);
      setManualDetails("");
      await loadManualActivities();
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  function handleEditActivity(activity: ManualActivity): void {
    setEditingActivityId(activity.id);
    setManualStartDate(activity.startDate);
    setManualDetails(activity.details);
  }

  function handleCancelEdit(): void {
    setEditingActivityId(null);
    setManualStartDate(getToday(timeZone).today);
    setManualDetails("");
  }

  async function handleDeleteManualActivity(
    activity: ManualActivity,
  ): Promise<void> {
    if (
      !window.confirm(`Delete the manual activity from ${activity.startDate}?`)
    ) {
      return;
    }
    try {
      const response = await fetchJsonAuthed<unknown>(
        `${API_URL}/api/coaching/activities/manual/${activity.id}?${coachingDateQuery()}`,
        auth,
        { method: "DELETE" },
      );
      parseSaveResponse(response);
      if (editingActivityId === activity.id) {
        handleCancelEdit();
      }
      await loadManualActivities();
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  function parseSaveResponse(response: unknown): void {
    const parsed = coachingInputSaveResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("Saving the activity returned an unexpected response", {
        cause: parsed.error,
      });
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadStatuses();
    void loadManualActivities();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!garmin?.connected) {
      return;
    }
    void loadAnalyses();
    // Re-run when Garmin connects, not every render.
  }, [garmin?.connected]);

  if (!auth.isAuthenticated) {
    return null;
  }

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {error && <p className="text-destructive">Error: {error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Activities</h2>
          <p className="text-sm text-muted-foreground">
            Every imported activity, plus anything you record manually.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
          onClick={() => void loadAnalyses(llm?.configured ?? false)}
          disabled={!garmin?.connected || syncing}
        >
          {syncing
            ? "Working…"
            : llm?.configured
              ? "Sync & re-analyze"
              : "Sync activities"}
        </button>
      </div>

      {!loading && (!garmin?.connected || !llm?.configured) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted p-3 text-sm">
          <span className="text-muted-foreground">
            {!garmin?.connected
              ? "Connect Garmin in Settings to import activities."
              : "Add an OpenRouter key in Settings to get coach analyses."}
          </span>
          <button
            type="button"
            className="rounded border bg-card px-3 py-1 enabled:hover:bg-muted"
            onClick={() => navigate("settings")}
          >
            Open settings
          </button>
        </div>
      )}

      <form
        className="flex flex-col gap-2 rounded-lg border bg-card p-4"
        onSubmit={(event) => void handleManualActivitySubmit(event)}
      >
        <label className="text-sm font-medium" htmlFor="manual-start-date">
          {editingActivityId ? "Edit manual activity" : "Manual activity"}
        </label>
        <input
          id="manual-start-date"
          name="startDate"
          type="date"
          className="w-fit rounded border bg-card px-2 py-1 text-sm"
          value={manualStartDate}
          onChange={(event) => setManualStartDate(event.target.value)}
        />
        <textarea
          name="details"
          placeholder="Describe your activity"
          className="w-full rounded border bg-card p-2 text-sm"
          rows={2}
          value={manualDetails}
          onChange={(event) => setManualDetails(event.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover"
          >
            {editingActivityId ? "Update activity" : "Add manual activity"}
          </button>
          {editingActivityId && (
            <button
              type="button"
              className="self-start rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {manualActivities.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Saved manual activities</h3>
          <ul className="flex flex-col gap-1">
            {manualActivities.map((activity) => (
              <li
                key={activity.id}
                className="flex items-start justify-between gap-2 rounded border bg-card p-2 text-sm"
              >
                <div className="flex flex-col gap-1">
                  <span>
                    <span className="font-medium">{activity.startDate}</span> —{" "}
                    {activity.details}
                  </span>
                  {activity.coachReply && (
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Coach:
                      </span>{" "}
                      {activity.coachReply.text}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => handleEditActivity(activity)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => void handleDeleteManualActivity(activity)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {syncing && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {llm?.configured
            ? "Syncing Garmin and asking the coach to analyse your workouts…"
            : "Syncing Garmin activities…"}
        </p>
      )}

      {!syncing && data && data.activities.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No activities in the last 31 days.
        </p>
      )}

      {data?.activities.map((activity) => (
        <ActivityCard
          key={activity.id}
          activity={activity}
          onSubmitComment={submitComment}
          onDelete={deleteActivity}
        />
      ))}
    </section>
  );
}
