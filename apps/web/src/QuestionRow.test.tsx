import { describe, expect, it } from "bun:test";
import type { Question } from "@killingit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionRow } from "./QuestionRow";

const question: Question = {
  id: 7,
  versionId: 11,
  prompt: "How did the long run feel?",
  required: false,
  version: 2,
  versionCount: 2,
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
};

describe("QuestionRow", () => {
  it("renders the prompt, version, required state, and actions", () => {
    const html = renderToStaticMarkup(
      <QuestionRow
        question={question}
        onSave={() => Promise.resolve()}
        onDelete={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("How did the long run feel?");
    expect(html).toContain("v2 of 2");
    expect(html).toContain("Optional");
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
  });

  it("renders reorder controls at the ends they are available", () => {
    const html = renderToStaticMarkup(
      <QuestionRow
        question={question}
        onSave={() => Promise.resolve()}
        onDelete={() => Promise.resolve()}
        onMoveUp={() => Promise.resolve()}
      />,
    );

    expect(html).toContain('data-testid="question-move-up"');
    expect(html).not.toContain('data-testid="question-move-down"');
  });
});
