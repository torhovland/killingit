import type { PeriodReview, ReviewKind } from "@killingit/shared";
import { Bullet } from "./Bullet";
import { CommentSection } from "./CommentSection";
import { FormattedText } from "./FormattedText";
import { useCommentForm } from "./useCommentForm";

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
  const commentForm = useCommentForm({
    storedComment: review.comment,
    storedReply: review.coachReply?.text ?? null,
    onSubmit:
      onSubmitComment === undefined
        ? undefined
        : (comment, mode) =>
            onSubmitComment(review.kind, review.startDate, comment, mode),
    onDismiss:
      onNoComment === undefined
        ? undefined
        : () => onNoComment(review.kind, review.startDate),
    dismissErrorMessage: "Could not mark the review",
  });

  return (
    <article
      className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left"
      data-testid="period-review-card"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold">{KIND_LABELS[review.kind]}</h3>
        <p className="text-base text-muted-foreground">
          {review.title}
          <Bullet />
          {review.startDate} → {review.endDate}
        </p>
      </header>

      <FormattedText
        text={review.summary.text}
        testId="period-review-summary"
      />

      {showWeeklyNote && review.weeklyNote && (
        <div
          className="flex flex-col gap-1 rounded border bg-inset p-2 text-base"
          data-testid="period-review-weekly-note"
        >
          <p className="whitespace-pre-line">
            <span className="font-medium">Your weekly note:</span>{" "}
            {review.weeklyNote.note}
          </p>
          {review.weeklyNote.coachReply && (
            <div
              className="flex flex-col gap-1"
              data-testid="period-review-weekly-note-reply"
            >
              <span className="font-medium">Coach:</span>
              <FormattedText text={review.weeklyNote.coachReply.text} />
            </div>
          )}
        </div>
      )}

      <CommentSection
        form={commentForm}
        editable={onSubmitComment !== undefined}
        testIdPrefix="period-review"
        ariaLabel={`Comment about this ${review.kind}`}
        placeholder="How did the week or block feel? Anything the coach should know?"
      >
        {commentForm.shownReply && (
          <div
            className="flex flex-col gap-1 text-base"
            data-testid="period-review-coach-reply"
          >
            <span className="font-medium">Coach:</span>
            <FormattedText text={commentForm.shownReply} />
          </div>
        )}
      </CommentSection>
    </article>
  );
}
