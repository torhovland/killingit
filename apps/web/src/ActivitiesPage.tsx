import { useEffect, useState } from "react";
import {
  manualActivitiesResponseSchema,
  type ManualActivity,
} from "@killingit/shared";
import { ActivityCard } from "./ActivityCard";
import { TrainingLoadLine } from "./TrainingLoadLine";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { parseCoachingSaveResponse } from "./coachingSave";
import { fetchJsonAuthed } from "./fetchAuthed";
import { FormattedText } from "./FormattedText";
import { useNavigate } from "./navigation";
import { reportError } from "./reportError";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { coachingDateQuery, useActivityFeed } from "./useActivityFeed";
import { useStatuses } from "./useStatuses";
import { getToday } from "./useToday";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * The activities page: every imported activity, the manual activity log, and
 * the sync / re-analyse action.
 */
export function ActivitiesPage() {
  const auth = useAuth();
  const { setStatus } = useAppStatus();
  const navigate = useNavigate();
  const timeZone = useTimeZone();
  const statuses = useStatuses(auth);
  const feed = useActivityFeed(auth, timeZone);
  const [manualActivities, setManualActivities] = useState<ManualActivity[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [editingActivityId, setEditingActivityId] = useState<number | null>(
    null,
  );
  const [manualStartDate, setManualStartDate] = useState(
    () => getToday(timeZone).today,
  );
  const [manualDetails, setManualDetails] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    setStatus("activities-page", feed.syncing ? "syncing" : null);
    return () => setStatus("activities-page", null);
  }, [feed.syncing, setStatus]);

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

  async function handleManualActivitySubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!manualStartDate || !manualDetails.trim() || savingManual) {
      return;
    }
    setSavingManual(true);
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
      parseCoachingSaveResponse(response);
      setEditingActivityId(null);
      setManualStartDate(getToday(timeZone).today);
      setManualDetails("");
      await Promise.all([loadManualActivities(), feed.loadCached()]);
    } catch (err: unknown) {
      setError(reportError(err));
    } finally {
      setSavingManual(false);
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
        `${API_URL}/api/coaching/activities/manual/${activity.id}?${coachingDateQuery(timeZone)}`,
        auth,
        { method: "DELETE" },
      );
      parseCoachingSaveResponse(response);
      if (editingActivityId === activity.id) {
        handleCancelEdit();
      }
      await Promise.all([loadManualActivities(), feed.loadCached()]);
    } catch (err: unknown) {
      setError(reportError(err));
    }
  }

  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    void loadManualActivities();
    // Only re-run when sign-in state flips; `auth` is consumed inside.
  }, [auth.isAuthenticated]);

  useEffect(() => {
    if (!statuses.garmin?.connected) {
      return;
    }
    void feed.loadAnalyses();
    // Re-run when Garmin connects, not every render.
  }, [statuses.garmin?.connected]);

  if (!auth.isAuthenticated) {
    return null;
  }

  // A sync only asks the coach to analyse the workouts when a model is set up.
  const syncLabel = feed.syncing
    ? statuses.llm?.configured
      ? "Coach is thinking…"
      : "Syncing…"
    : statuses.llm?.configured
      ? "Sync & re-analyze"
      : "Sync activities";
  // A manual entry is saved with the coach's TSS estimate and reply.
  const manualLabel = savingManual
    ? statuses.llm?.configured
      ? "Coach is thinking…"
      : "Saving…"
    : editingActivityId !== null
      ? "Update activity"
      : "Add manual activity";
  const errorMessage = error ?? feed.error ?? statuses.error;

  return (
    <section className="flex w-full flex-col gap-4 text-left">
      {errorMessage && (
        <p className="text-destructive">Error: {errorMessage}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold">Activities</h2>
          <p className="text-base text-muted-foreground">
            Every imported activity, plus anything you record manually.
          </p>
        </div>
        <SubmitButton
          type="button"
          busy={feed.syncing}
          className="rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
          onClick={() =>
            void feed.loadAnalyses(statuses.llm?.configured ?? false)
          }
          disabled={!statuses.garmin?.connected}
        >
          {syncLabel}
        </SubmitButton>
      </div>

      {!statuses.loading &&
        (!statuses.garmin?.connected || !statuses.llm?.configured) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted p-3 text-base">
            <span className="text-muted-foreground">
              {!statuses.garmin?.connected
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
        <label className="text-base font-medium" htmlFor="manual-start-date">
          {editingActivityId ? "Edit manual activity" : "Manual activity"}
        </label>
        <input
          id="manual-start-date"
          name="startDate"
          type="date"
          className="w-fit rounded border bg-card px-2 py-1 text-base"
          value={manualStartDate}
          onChange={(event) => setManualStartDate(event.target.value)}
          disabled={savingManual}
        />
        <textarea
          name="details"
          placeholder="Describe your activity"
          className="w-full rounded border bg-card p-2 text-base"
          rows={2}
          value={manualDetails}
          onChange={(event) => setManualDetails(event.target.value)}
          disabled={savingManual}
        />
        <div className="flex gap-2">
          <SubmitButton
            busy={savingManual}
            className="self-start rounded border border-transparent bg-primary px-3 py-1 text-base text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={!manualStartDate || !manualDetails.trim()}
          >
            {manualLabel}
          </SubmitButton>
          {editingActivityId && (
            <button
              type="button"
              className="self-start rounded border bg-card px-3 py-1 text-base enabled:hover:bg-muted disabled:opacity-50"
              onClick={handleCancelEdit}
              disabled={savingManual}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {manualActivities.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-medium">Saved manual activities</h3>
          <ul className="flex flex-col gap-1">
            {manualActivities.map((activity) => (
              <li
                key={activity.id}
                className="flex items-start justify-between gap-2 rounded border bg-card p-2 text-base"
              >
                <div className="flex flex-col gap-1">
                  <span>
                    <span className="font-medium">{activity.startDate}</span> —{" "}
                    {activity.details}
                  </span>
                  {activity.coachReply && (
                    <div className="flex flex-col gap-1 text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Coach:
                      </span>
                      <FormattedText text={activity.coachReply.text} />
                    </div>
                  )}
                  {activity.trainingLoad !== null &&
                    activity.trainingLoad !== undefined && (
                      <TrainingLoadLine
                        load={activity.trainingLoad}
                        tss={activity.estimatedTss ?? undefined}
                        testId="manual-activity-load"
                      />
                    )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground hover:underline"
                    onClick={() => handleEditActivity(activity)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-sm text-destructive hover:underline"
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

      {feed.syncing && (
        <p className="text-base text-muted-foreground" aria-live="polite">
          {statuses.llm?.configured
            ? "Syncing Garmin and asking the coach to analyse your workouts…"
            : "Syncing Garmin activities…"}
        </p>
      )}

      {!feed.syncing && feed.data && feed.data.activities.length === 0 && (
        <p className="text-base text-muted-foreground">
          No synced activities yet.
        </p>
      )}

      {feed.data?.activities.map((activity) => (
        <ActivityCard
          key={activity.id}
          activity={activity}
          onSubmitComment={feed.submitComment}
          onDelete={feed.deleteActivity}
        />
      ))}
    </section>
  );
}
