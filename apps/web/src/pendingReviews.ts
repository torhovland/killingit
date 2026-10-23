import type { PeriodReview } from "@killingit/shared";

/** The stable key for a review across the dashboard and its visit state. */
export function reviewKey(
  review: Pick<PeriodReview, "kind" | "startDate">,
): string {
  return `${review.kind}:${review.startDate}`;
}

/**
 * Reviews that still need the athlete's attention on the main page. A review
 * answered during this visit stays visible until the page is reloaded, even if
 * a later fetch reports that it now has a comment.
 */
export function selectPendingReviews(
  reviews: readonly PeriodReview[],
  keptForVisit: ReadonlySet<string> = new Set(),
): PeriodReview[] {
  return reviews.filter(
    (review) =>
      keptForVisit.has(reviewKey(review)) ||
      (review.comment === null && !review.reviewed),
  );
}
