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
  },
];

describe("AthleteAnswersSection", () => {
  it("lists the saved answers and offers an edit action", () => {
    const html = renderToStaticMarkup(
      <AthleteAnswersSection
        questions={questions}
        onSubmit={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Your athlete profile");
    expect(html).toContain("How did the long run feel?");
    expect(html).toContain("Strong until the last 3 km.");
    expect(html).toContain("Anything else your coach should know?");
    expect(html).toContain("Skipped");
    expect(html).toContain("Edit answers");
  });
});
