import { describe, expect, it } from "bun:test";
import type { AthleteQuestion } from "@killingit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { AthleteAnswersSection } from "./AthleteAnswersSection";

const questions: AthleteQuestion[] = [
  {
    id: 7,
    versionId: 11,
    prompt: "How did the long run feel?",
    required: true,
    version: 2,
    versionCount: 2,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-21T09:00:00.000Z",
    answer: "Strong until the last 3 km.",
    skipped: false,
    answeredAt: "2026-10-21T10:00:00.000Z",
    previous: null,
  },
  {
    id: 8,
    versionId: 12,
    prompt: "Anything else your coach should know?",
    required: false,
    version: 1,
    versionCount: 1,
    createdAt: "2026-10-21T09:00:00.000Z",
    updatedAt: "2026-10-21T09:00:00.000Z",
    answer: null,
    skipped: true,
    answeredAt: "2026-10-21T10:00:00.000Z",
    previous: null,
  },
  {
    id: 9,
    versionId: 14,
    prompt: "How many hours can you train each week?",
    required: true,
    version: 2,
    versionCount: 2,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    answer: null,
    skipped: false,
    answeredAt: null,
    previous: {
      versionId: 13,
      version: 1,
      prompt: "How many hours do you train each week?",
      answer: "About six.",
      skipped: false,
      answeredAt: "2026-10-21T10:00:00.000Z",
    },
  },
  {
    id: 10,
    versionId: 15,
    prompt: "What is your resting heart rate?",
    required: false,
    version: 1,
    versionCount: 1,
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    answer: null,
    skipped: false,
    answeredAt: null,
    previous: null,
  },
];

describe("AthleteAnswersSection", () => {
  it("groups updated, new, and answered questions with editable answers", () => {
    const html = renderToStaticMarkup(
      <AthleteAnswersSection
        questions={questions}
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Updated questions");
    expect(html).toContain("New questions");
    expect(html).toContain("Answered questions");
    expect(html).toContain("How did the long run feel?");
    expect(html).toContain("Strong until the last 3 km.");
    expect(html).toContain("Anything else your coach should know?");
    expect(html).toContain("You skipped this optional question");
    expect(html).toContain("How many hours can you train each week?");
    expect(html).toContain("How many hours do you train each week?");
    expect(html).toContain("About six.");
    expect(html).toContain("Copy old answer");
    expect(html).toContain("What is your resting heart rate?");
    expect(html).toContain("Save answer");
    expect(html).not.toContain("Edit answers");
  });

  it("calls the first section Coaching questions when nothing has been answered", () => {
    const html = renderToStaticMarkup(
      <AthleteAnswersSection
        questions={[questions[3]!]}
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Coaching questions");
    expect(html).not.toContain("New questions");
    expect(html).not.toContain("Answered questions");
  });
});
