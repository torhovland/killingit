import { describe, expect, it } from "bun:test";
import {
  periodReviewSchema,
  periodReviewsResponseSchema,
  reviewKindSchema,
} from "./index.js";

const review = {
  kind: "week",
  startDate: "2026-10-13",
  endDate: "2026-10-19",
  title: "Week starting 2026-10-13",
  summary: {
    text: "A consistent week of easy aerobic work.",
    model: "test-model",
    generatedAt: "2026-10-20T09:00:00.000Z",
  },
  comment: null,
  coachReply: null,
  reviewed: false,
};

describe("period review schemas", () => {
  it("parses a week review", () => {
    const parsed = periodReviewSchema.parse(review);
    expect(parsed.kind).toBe("week");
    expect(parsed.summary.text).toContain("consistent");
  });

  it("defaults the optional feedback fields", () => {
    const parsed = periodReviewSchema.parse({
      kind: "block",
      startDate: "2026-09-01",
      endDate: "2026-10-01",
      title: "Base",
      summary: review.summary,
    });
    expect(parsed.comment).toBeNull();
    expect(parsed.coachReply).toBeNull();
    expect(parsed.reviewed).toBe(false);
  });

  it("rejects an unknown review kind", () => {
    expect(reviewKindSchema.safeParse("season").success).toBe(false);
  });

  it("parses a review list response", () => {
    const parsed = periodReviewsResponseSchema.parse({ reviews: [review] });
    expect(parsed.reviews).toHaveLength(1);
  });
});
