import { describe, expect, it } from "bun:test";
import type { CoachQuestion } from "@killingit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { CoachQuestionCard } from "./CoachQuestionCard";

const question: CoachQuestion = {
  id: 7,
  question: "How many hours can you train on weekdays?",
  answer: null,
  coachReply: null,
  createdAt: "2026-10-20T09:00:00.000Z",
  answeredAt: null,
};

describe("CoachQuestionCard", () => {
  it("asks the athlete to answer a pending question", () => {
    const html = renderToStaticMarkup(
      <CoachQuestionCard
        question={question}
        onSubmitAnswer={() => Promise.resolve(null)}
      />,
    );

    expect(html).toContain("Coach question");
    expect(html).toContain("How many hours can you train on weekdays?");
    expect(html).toContain('data-testid="coach-question-form"');
    expect(html).toContain("Answer coach");
  });

  it("renders an answered question with the coach reply", () => {
    const html = renderToStaticMarkup(
      <CoachQuestionCard
        question={{
          ...question,
          answer: "About six hours.",
          coachReply: {
            text: "That is enough for a steady base block.",
            model: "test-model",
            generatedAt: "2026-10-20T10:00:00.000Z",
          },
          answeredAt: "2026-10-20T10:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("About six hours.");
    expect(html).toContain("That is enough for a steady base block.");
    expect(html).not.toContain('data-testid="coach-question-form"');
  });
});
