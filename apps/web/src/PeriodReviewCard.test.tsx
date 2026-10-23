import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PeriodReview } from "@killingit/shared";
import { PeriodReviewCard } from "./PeriodReviewCard";

const review: PeriodReview = {
  kind: "week",
  startDate: "2026-10-13",
  endDate: "2026-10-19",
  title: "Week starting 2026-10-13",
  summary: {
    text: "You completed five of six planned sessions and handled the load well.",
    model: "test-model",
    generatedAt: "2026-10-20T09:00:00.000Z",
  },
  comment: null,
  coachReply: null,
  reviewed: false,
};

describe("PeriodReviewCard", () => {
  it("renders the coach summary and ask for feedback", () => {
    const html = renderToStaticMarkup(
      <PeriodReviewCard
        review={review}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(html).toContain("Week review");
    expect(html).toContain("Week starting 2026-10-13");
    expect(html).toContain("five of six planned sessions");
    expect(html).toContain('data-testid="period-review-comment-form"');
  });

  it("renders the athlete comment and coach reply", () => {
    const html = renderToStaticMarkup(
      <PeriodReviewCard
        review={{
          ...review,
          kind: "block",
          title: "Base",
          comment: "I felt strong all block.",
          coachReply: {
            text: "Great consistency; keep the next block similar.",
            model: "test-model",
            generatedAt: "2026-10-20T10:00:00.000Z",
          },
        }}
        onSubmitComment={() => Promise.resolve(null)}
      />,
    );

    expect(html).toContain("Block review");
    expect(html).toContain("I felt strong all block.");
    expect(html).toContain("Great consistency");
    expect(html).toContain('data-testid="period-review-comment-edit"');
    expect(html).toContain("Edit comment");
  });
});
