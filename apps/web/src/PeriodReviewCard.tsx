import { useState } from "react";
import type { PeriodReview, ReviewKind } from "@killingit/shared";

const KIND_LABELS: Record<ReviewKind, string> = {
  week: "Week review",
  block: "Block review",
};

/**
 * One coach summary of a completed week or block, with the athlete's comment
 * and the coach's reply. Presentational only so it can be rendered without any
 * data fetching.
 */
export function PeriodReviewCard({
  review,
  onSubmitComment,
  onNoComment,
  showWeeklyNote = false,
}: {
  review: PeriodReview;
  onSubmitComment?: (
    kind: ReviewKind,
    startDate: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  onNoComment?: (kind: ReviewKind, startDate: string) => Promise<void>;
  /** Show the week's saved note and the coach's reply for reference. */
  showWeeklyNote?: boolean;
}) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedComment, setSavedComment] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

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
        review.kind,
        review.startDate,
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
      await onNoComment(review.kind, review.startDate);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not mark the review",
      );
    } finally {
      setDismissing(false);
    }
  }

  const shownComment = savedComment ?? review.comment;
  const shownReply = coachReply ?? review.coachReply?.text ?? null;

  return (
    <article
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left"
      data-testid="period-review-card"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">{KIND_LABELS[review.kind]}</h3>
        <p className="text-sm text-muted-foreground">
          {review.title} · {review.startDate} → {review.endDate}
        </p>
      </header>

      <p className="whitespace-pre-line" data-testid="period-review-summary">
        {review.summary.text}
      </p>

      {showWeeklyNote && review.weeklyNote && (
        <div
          className="flex flex-col gap-1 rounded border bg-muted p-2 text-sm"
          data-testid="period-review-weekly-note"
        >
          <p className="whitespace-pre-line">
            <span className="font-medium">Your weekly note:</span>{" "}
            {review.weeklyNote.note}
          </p>
          {review.weeklyNote.coachReply && (
            <p
              className="whitespace-pre-line"
              data-testid="period-review-weekly-note-reply"
            >
              <span className="font-medium">Coach:</span>{" "}
              {review.weeklyNote.coachReply.text}
            </p>
          )}
        </div>
      )}

      {shownComment && (
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <p data-testid="period-review-comment">
            <span className="font-medium">You:</span> {shownComment}
          </p>
          {onSubmitComment && !editing && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={handleEditComment}
              data-testid="period-review-comment-edit"
            >
              Edit comment
            </button>
          )}
        </div>
      )}

      {shownReply && (
        <p className="text-sm" data-testid="period-review-coach-reply">
          <span className="font-medium">Coach:</span> {shownReply}
        </p>
      )}

      {onSubmitComment && (shownComment === null || editing) && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => void handleSubmit(event)}
          data-testid="period-review-comment-form"
        >
          <textarea
            aria-label={`Comment about this ${review.kind}`}
            className="w-full rounded border bg-card p-2 text-sm"
            placeholder="How did the week or block feel? Anything the coach should know?"
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
              {submitting
                ? "Saving…"
                : shownComment === null
                  ? "Save comment"
                  : "Save changes"}
            </button>
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
                data-testid="period-review-no-comment"
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
