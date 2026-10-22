import { useState } from "react";
import { formatActivityType, type AnalyzedActivity } from "@killingit/shared";
import { ActivityMap } from "./ActivityMap";
import { useTimeZone } from "./TimeZoneContext";
import { formatDateTime } from "./timeZone";

/** Formats seconds as `m:ss` or `h:mm:ss` for activity metadata. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/**
 * One synced activity with its coach analysis and program review.
 * Presentational only so it can be rendered and tested without any data
 * fetching. When `onSubmitComment` is provided, the card also offers a comment
 * box; the saved comment feeds the next plan revision and the coach replies
 * immediately.
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
      const reply = await onSubmitComment(String(activity.id), submitted);
      setSavedComment(submitted);
      setCoachReply(reply);
      setComment("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save comment");
    } finally {
      setSubmitting(false);
    }
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
              {metadata.join(" · ")}
              {onDelete && (
                <>
                  {" · "}
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

      {shownComment && (
        <p className="text-sm" data-testid="activity-comment">
          <span className="font-medium">You:</span> {shownComment}
        </p>
      )}

      {shownReply && (
        <p className="text-sm" data-testid="activity-coach-reply">
          <span className="font-medium">Coach:</span> {shownReply}
        </p>
      )}

      {onSubmitComment && (
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
            <button
              type="submit"
              className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
              disabled={submitting || !comment.trim()}
            >
              {submitting ? "Saving…" : "Save comment"}
            </button>
            {onNoComment && (
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
