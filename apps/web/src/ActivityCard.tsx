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
 * One synced activity with its coach analysis. Presentational only so it can be
 * rendered and tested without any data fetching. When `onSubmitComment` is
 * provided, the card also offers a comment box so the athlete can tell the coach
 * how the session felt; the saved comment feeds the next plan revision.
 */
export function ActivityCard({
  activity,
  onSubmitComment,
}: {
  activity: AnalyzedActivity;
  onSubmitComment?: (activityId: string, comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!onSubmitComment || !comment.trim()) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmitComment(String(activity.id), comment);
      setComment("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save comment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left"
      data-testid="activity-card"
    >
      <header className="flex flex-col gap-1">
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
      </header>

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
