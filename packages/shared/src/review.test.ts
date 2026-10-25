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
  weeklyNote: {
    note: "I cannot train on Thursday this week.",
    coachReply: {
      text: "I moved Thursday's session to Friday.",
      model: "test-model",
      generatedAt: "2026-10-14T09:00:00.000Z",
    },
  },
  reviewed: false,
};

describe("period review schemas", () => {
  it("parses a week review with its weekly note", () => {
    const parsed = periodReviewSchema.parse(review);
    expect(parsed.kind).toBe("week");
    expect(parsed.summary.text).toContain("consistent");
    expect(parsed.weeklyNote?.note).toContain("Thursday");
    expect(parsed.weeklyNote?.coachReply?.text).toContain("Friday");
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
    expect(parsed.weeklyNote).toBeNull();
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
