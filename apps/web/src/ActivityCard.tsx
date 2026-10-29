import { useState } from "react";
import { formatActivityType, type AnalyzedActivity } from "@killingit/shared";
import { ActivityMap } from "./ActivityMap";
import { ActivitySamples } from "./ActivitySamples";
import { Bullet, Bullets } from "./Bullet";
import { formatDuration } from "./formatDuration";
import { SubmitButton } from "./SubmitButton";
import { TrainingLoadLine } from "./TrainingLoadLine";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";

/**
 * One synced activity with its coach analysis and program review.
 * Presentational only so it can be rendered and tested without any data
 * fetching. When `onSubmitComment` is provided, the card offers a comment box
 * for activities without a comment, and an edit action for the single comment
 * an activity may have. Saving a comment feeds the next plan revision and the
 * coach replies immediately.
 */
export function ActivityCard({
  activity,
  onSubmitComment,
  onNoComment,
  onDelete,
}: {
  activity: AnalyzedActivity;
  onSubmitComment?: (
    activityId: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  onNoComment?: (activityId: string) => Promise<void>;
  onDelete?: (activityId: string) => Promise<void>;
}) {
  const timeZone = useTimeZone();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savedComment, setSavedComment] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  async function handleDelete(): Promise<void> {
    if (!onDelete || deleting) {
      return;
    }
    if (!window.confirm("Delete this activity from your coaching view?")) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(String(activity.id));
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete activity",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!onSubmitComment || !comment.trim()) {
      return;
    }
    const submitted = comment.trim();
    setSubmitting(true);
    setError(null);
    try {
      const reply = await onSubmitComment(
        String(activity.id),
        submitted,
        shownComment === null ? "create" : "edit",
      );
      setSavedComment(submitted);
      setCoachReply(reply);
      setComment("");
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save comment");
    } finally {
      setSubmitting(false);
    }
  }

  function handleEditComment(): void {
    setComment(shownComment ?? "");
    setError(null);
    setEditing(true);
  }

  function handleCancelEdit(): void {
    setEditing(false);
    setComment("");
    setError(null);
  }

  async function handleNoComment(): Promise<void> {
    if (!onNoComment || dismissing) {
      return;
    }
    setDismissing(true);
    setError(null);
    try {
      await onNoComment(String(activity.id));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not mark the activity",
      );
    } finally {
      setDismissing(false);
    }
  }

  const shownComment = savedComment ?? activity.comment;
  const shownReply = coachReply ?? activity.coachReply?.text ?? null;
  // Plan fit is part of the coach summary, not its own section. The program
  // review (when present) is the plan-aware summary; otherwise use the general
  // analysis.
  const summary =
    activity.programAnalysis?.text.trim() || activity.analysis?.text.trim();
  const route = activity.route ?? [];
  const hasMap = route.length >= 2;
  const metadata = [
    formatDateTime(activity.startDate, timeZone),
    formatActivityType(activity.type),
  ];
  if (activity.distance > 0) {
    metadata.push(`${(activity.distance / 1000).toFixed(2)} km`);
  }
  metadata.push(formatDuration(activity.elapsedTime));
  if (activity.totalElevationGain > 0) {
    metadata.push(`${Math.round(activity.totalElevationGain)} m climb`);
  }

  return (
    <article
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left"
      data-testid="activity-card"
    >
      <div
        className={
          hasMap
            ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start"
            : "flex flex-col gap-2"
        }
      >
        <div className="flex flex-col gap-2">
          <header className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold">{activity.name}</h3>
            <p className="text-sm text-muted-foreground">
              <Bullets parts={metadata} />
              {onDelete && (
                <>
                  <Bullet />
                  <button
                    type="button"
                    className="text-destructive enabled:hover:underline disabled:opacity-50"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    data-testid="activity-delete"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </>
              )}
            </p>
          </header>

          {deleteError && (
            <p className="text-xs text-destructive">{deleteError}</p>
          )}

          {activity.trainingLoad !== null &&
            activity.trainingLoad !== undefined && (
              <TrainingLoadLine
                load={activity.trainingLoad}
                tss={activity.activityTss ?? undefined}
                testId="activity-load"
              />
            )}

          {summary ? (
            <p className="whitespace-pre-line" data-testid="activity-analysis">
              {summary}
            </p>
          ) : (
            <p
              className="rounded bg-accent/15 p-2 text-sm"
              data-testid="activity-analysis-error"
            >
              {activity.analysisError
                ? `Coach analysis unavailable: ${activity.analysisError}`
                : "No coach analysis available yet."}
            </p>
          )}
        </div>
        {hasMap && <ActivityMap route={route} />}
      </div>

      {activity.samples.length > 0 && (
        <ActivitySamples
          samples={activity.samples}
          sampleCount={activity.sampleCount}
          activityType={activity.type}
        />
      )}

      {shownComment && (
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <p data-testid="activity-comment">
            <span className="font-medium">You:</span> {shownComment}
          </p>
          {onSubmitComment && !editing && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={handleEditComment}
              data-testid="activity-comment-edit"
            >
              Edit comment
            </button>
          )}
        </div>
      )}

      {shownReply && (
        <p className="text-sm" data-testid="activity-coach-reply">
          <span className="font-medium">Coach:</span> {shownReply}
        </p>
      )}

      {onSubmitComment && (shownComment === null || editing) && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void handleSubmit(event)}
          data-testid="activity-comment-form"
        >
          <textarea
            id={`activity-comment-${activity.id}`}
            aria-label="Comment about this activity"
            className="w-full rounded border bg-card p-2 text-sm"
            placeholder="How did it feel? Anything the coach should know?"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={submitting}
            rows={2}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              busy={submitting}
              className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
              disabled={!comment.trim()}
            >
              {submitting ? "Coach is thinking…" : "Send to coach"}
            </SubmitButton>
            {shownComment !== null && (
              <button
                type="button"
                className="self-start rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted disabled:opacity-50"
                onClick={handleCancelEdit}
                disabled={submitting}
              >
                Cancel
              </button>
            )}
            {onNoComment && shownComment === null && (
              <button
                type="button"
                className="self-start rounded border bg-card px-3 py-1 text-sm enabled:hover:bg-muted disabled:opacity-50"
                onClick={() => void handleNoComment()}
                disabled={dismissing || submitting}
                data-testid="activity-no-comment"
              >
                {dismissing ? "Saving…" : "No comment"}
              </button>
            )}
          </div>
        </form>
      )}
    </article>
  );
}
