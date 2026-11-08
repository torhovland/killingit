import { useEffect } from "react";
import { ActivityList } from "./ActivityList";
import { useAppStatus } from "./AppStatus";
import { useAuth } from "./auth";
import { ManualActivityForm } from "./ManualActivityForm";
import { ManualActivityList } from "./ManualActivityList";
import { useNavigate } from "./navigation";
import { SubmitButton } from "./SubmitButton";
import { useTimeZone } from "./TimeZoneContext";
import { useActivityFeed } from "./useActivityFeed";
import { useManualActivities } from "./useManualActivities";
import { useStatuses } from "./useStatuses";

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
  const manual = useManualActivities(auth, timeZone, feed.loadCached);

  useEffect(() => {
    setStatus("activities-page", feed.syncing ? "syncing" : null);
    return () => setStatus("activities-page", null);
  }, [feed.syncing, setStatus]);

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
  const errorMessage = manual.error ?? feed.error ?? statuses.error;

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

      <ManualActivityForm
        editing={manual.editing !== null}
        startDate={manual.startDate}
        details={manual.details}
        saving={manual.saving}
        llmConfigured={statuses.llm?.configured ?? false}
        onStartDateChange={manual.setStartDate}
        onDetailsChange={manual.setDetails}
        onSubmit={(event) => void manual.submit(event)}
        onCancel={manual.cancelEdit}
      />

      <ManualActivityList
        activities={manual.activities}
        onEdit={manual.edit}
        onDelete={manual.remove}
      />

      {feed.syncing && (
        <p className="text-base text-muted-foreground" aria-live="polite">
          {statuses.llm?.configured
            ? "Syncing Garmin and asking the coach to analyse your workouts…"
            : "Syncing Garmin activities…"}
        </p>
      )}

      <ActivityList
        activities={feed.data?.activities ?? []}
        emptyMessage={
          !feed.syncing && feed.data ? "No synced activities yet." : undefined
        }
        onSubmitComment={feed.submitComment}
        onDelete={feed.deleteActivity}
      />
    </section>
  );
}
