import { describe, expect, it } from "bun:test";
import type { PeriodReview } from "@killingit/shared";
import { reviewKey, selectPendingReviews } from "./pendingReviews";

function review(overrides: Partial<PeriodReview> = {}): PeriodReview {
  return {
    kind: "week",
    startDate: "2026-10-13",
    endDate: "2026-10-19",
    title: "Week starting 2026-10-13",
    summary: {
      text: "A consistent week.",
      model: "test-model",
      generatedAt: "2026-10-20T09:00:00.000Z",
    },
    comment: null,
    coachReply: null,
    reviewed: false,
    ...overrides,
  };
}

describe("selectPendingReviews", () => {
  it("keeps reviews without a comment and not dismissed", () => {
    expect(selectPendingReviews([review()])).toHaveLength(1);
  });

  it("drops commented and dismissed reviews after a reload", () => {
    const reviews = [
      review({ kind: "week", comment: "Felt strong." }),
      review({ kind: "block", startDate: "2026-09-01", reviewed: true }),
    ];
    expect(selectPendingReviews(reviews)).toEqual([]);
  });

  it("keeps a review answered during this visit", () => {
    const commented = review({ comment: "Felt strong." });
    expect(
      selectPendingReviews([commented], new Set([reviewKey(commented)])),
    ).toHaveLength(1);
  });
});
