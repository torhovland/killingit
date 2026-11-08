import type { PeriodReview, ReviewKind } from "@killingit/shared";
import { PeriodReviewCard } from "./PeriodReviewCard";

/**
 * Completed weeks and blocks whose coach summary the athlete has not answered
 * yet. Block reviews are listed first, then week reviews.
 */
export function PendingReviewsList({
  reviews,
  onSubmitComment,
  onNoComment,
}: {
  reviews: PeriodReview[];
  onSubmitComment?: (
    kind: ReviewKind,
    startDate: string,
    comment: string,
    mode: "create" | "edit",
  ) => Promise<string | null>;
  onNoComment?: (kind: ReviewKind, startDate: string) => Promise<void>;
}) {
  if (reviews.length === 0) {
    return null;
  }

  const blocks = reviews.filter((review) => review.kind === "block");
  const weeks = reviews.filter((review) => review.kind === "week");
  const handlers = {
    ...(onSubmitComment ? { onSubmitComment } : {}),
    ...(onNoComment ? { onNoComment } : {}),
  };

  return (
    <section className="flex flex-col gap-3" data-testid="pending-reviews">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">Completed training</h2>
        <p className="text-base text-muted-foreground">
          Review your coach's summary and add a comment.
        </p>
      </div>
      {blocks.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xl font-medium">Block reviews</h3>
          {blocks.map((review) => (
            <PeriodReviewCard
              key={`block:${review.startDate}`}
              review={review}
              {...handlers}
            />
          ))}
        </div>
      )}
      {weeks.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xl font-medium">Week reviews</h3>
          {weeks.map((review) => (
            <PeriodReviewCard
              key={`week:${review.startDate}`}
              review={review}
              {...handlers}
            />
          ))}
        </div>
      )}
    </section>
  );
}
