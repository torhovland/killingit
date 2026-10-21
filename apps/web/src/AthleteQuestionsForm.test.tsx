import { describe, expect, it } from "bun:test";
import type { AthleteQuestion } from "@killingit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { AthleteQuestionsForm } from "./AthleteQuestionsForm";

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
    skipped: false,
    answeredAt: null,
  },
];

describe("AthleteQuestionsForm", () => {
  it("renders prompts, required state, existing answers, and the submit action", () => {
    const html = renderToStaticMarkup(
      <AthleteQuestionsForm
        questions={questions}
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("How did the long run feel?");
    expect(html).toContain("Anything else your coach should know?");
    expect(html).toContain("Required");
    expect(html).toContain("Optional");
    expect(html).toContain("Strong until the last 3 km.");
    expect(html).toContain("Save and continue");
  });

  it("explains that required questions gate activities", () => {
    const html = renderToStaticMarkup(
      <AthleteQuestionsForm
        questions={questions}
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("before you see your activities");
    expect(html).toContain("include or skip the optional ones");
  });

  it("renders the edit variant with save and cancel actions", () => {
    const html = renderToStaticMarkup(
      <AthleteQuestionsForm
        questions={questions}
        onSubmit={() => Promise.resolve()}
        variant="edit"
        onCancel={() => {}}
      />,
    );

    expect(html).toContain("Edit your answers");
    expect(html).toContain("Save changes");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Save and continue");
  });
});
