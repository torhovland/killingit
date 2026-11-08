import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PeriodReview } from "@killingit/shared";
import { PendingReviewsList } from "./PendingReviewsList";

const review: PeriodReview = {
  kind: "week",
  startDate: "2026-10-13",
  endDate: "2026-10-19",
  title: "Week starting 2026-10-13",
  summary: {
    text: "You completed five of six planned sessions.",
    model: "test-model",
    generatedAt: "2026-10-20T09:00:00.000Z",
  },
  comment: null,
  coachReply: null,
  weeklyNote: null,
  reviewed: false,
};

describe("PendingReviewsList", () => {
  it("renders nothing when no review needs attention", () => {
    expect(renderToStaticMarkup(<PendingReviewsList reviews={[]} />)).toBe("");
  });

  it("groups block and week reviews", () => {
    const html = renderToStaticMarkup(
      <PendingReviewsList
        reviews={[{ ...review, kind: "block", title: "Base block" }, review]}
      />,
    );

    expect(html).toContain("Completed training");
    expect(html).toContain("Block reviews");
    expect(html).toContain("Week reviews");
    expect(html).toContain("Base block");
    expect(html).toContain("Week starting 2026-10-13");
  });
});
