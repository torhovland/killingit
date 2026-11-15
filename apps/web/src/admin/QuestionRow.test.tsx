import { describe, expect, it } from "bun:test";
import type { Question } from "@killingit/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("asks for confirmation before archiving and focuses the safe action", async () => {
    const user = userEvent.setup();
    let archived = 0;
    render(
      <QuestionRow
        question={question}
        onSave={() => Promise.resolve()}
        onDelete={() => {
          archived += 1;
          return Promise.resolve();
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Archive this question?")).toBeDefined();
    expect(
      within(dialog).getByText(/Existing versions are kept/),
    ).toBeDefined();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    expect(archived).toBe(0);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(archived).toBe(0);
  });

  it("archives the question only after the destructive action is confirmed", async () => {
    const user = userEvent.setup();
    let archived = 0;
    render(
      <QuestionRow
        question={question}
        onSave={() => Promise.resolve()}
        onDelete={() => {
          archived += 1;
          return Promise.resolve();
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );

    await waitFor(() => expect(archived).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open with the error when archiving fails", async () => {
    const user = userEvent.setup();
    render(
      <QuestionRow
        question={question}
        onSave={() => Promise.resolve()}
        onDelete={() => Promise.reject(new Error("Could not archive"))}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Error: Could not archive")).toBeDefined();
  });
});
