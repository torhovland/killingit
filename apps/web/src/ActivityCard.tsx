import { useState } from "react";
import type { AnalyzedActivity } from "@killingit/shared";

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

/** Formats an ISO timestamp as a stable, UTC-labelled string. */
function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
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
  onDelete,
}: {
  activity: AnalyzedActivity;
  onSubmitComment?: (
    activityId: string,
    comment: string,
  ) => Promise<string | null>;
  onDelete?: (activityId: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savedComment, setSavedComment] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<string | null>(null);

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

  const shownComment = savedComment ?? activity.comment;
  const shownReply = coachReply ?? activity.coachReply?.text ?? null;

  return (
    <article
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left"
      data-testid="activity-card"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">{activity.name}</h3>
          <p className="text-sm text-muted-foreground">
            {formatDate(activity.startDate)} · {activity.type} ·{" "}
            {(activity.distance / 1000).toFixed(2)} km ·{" "}
            {formatDuration(activity.movingTime)} ·{" "}
            {Math.round(activity.totalElevationGain)} m climb
            {activity.sampleCount > 0 && (
              <span>
                {" "}
                · {activity.sampleCount} sample
                {activity.sampleCount === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>
        {onDelete && (
          <button
            type="button"
            className="text-xs text-destructive enabled:hover:underline disabled:opacity-50"
            onClick={() => void handleDelete()}
            disabled={deleting}
            data-testid="activity-delete"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </header>

      {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

      {activity.analysis ? (
        <p className="whitespace-pre-line" data-testid="activity-analysis">
          {activity.analysis.text}
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

      {activity.analysis && (
        <footer className="text-xs text-muted-foreground">
          {activity.analysis.model} ·{" "}
          {formatDate(activity.analysis.generatedAt)}
        </footer>
      )}

      {activity.programAnalysis && (
        <section
          className="flex flex-col gap-1 rounded border bg-muted/60 p-2"
          data-testid="activity-program-analysis"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How it fit your plan
          </h4>
          <p className="whitespace-pre-line">{activity.programAnalysis.text}</p>
        </section>
      )}

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
          className="flex flex-col gap-2 border-t pt-2"
          onSubmit={(event) => void handleSubmit(event)}
          data-testid="activity-comment-form"
        >
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={`activity-comment-${activity.id}`}
          >
            Add a comment about this activity
          </label>
          <textarea
            id={`activity-comment-${activity.id}`}
            className="w-full rounded border bg-card p-2 text-sm"
            placeholder="How did it feel? Anything the coach should know?"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={submitting}
            rows={2}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            className="self-start rounded border border-transparent bg-primary px-3 py-1 text-sm text-primary-foreground enabled:hover:bg-primary-hover disabled:opacity-50"
            disabled={submitting || !comment.trim()}
          >
            {submitting ? "Saving…" : "Save comment"}
          </button>
        </form>
      )}
    </article>
  );
}
