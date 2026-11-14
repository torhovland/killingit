import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  useCommentForm,
  type CommentFormOptions,
  type CommentMode,
} from "./useCommentForm";

function Harness({ options }: { options: CommentFormOptions }) {
  const form = useCommentForm(options);
  return (
    <div>
      <p data-testid="comment">{form.shownComment ?? "none"}</p>
      <p data-testid="reply">{form.shownReply ?? "none"}</p>
      <form onSubmit={(event) => void form.submit(event)}>
        <textarea
          aria-label="Comment"
          value={form.comment}
          onChange={(event) => form.setComment(event.target.value)}
          disabled={form.submitting}
        />
        <button type="submit" disabled={form.submitting}>
          {form.submitting ? "Saving…" : "Save"}
        </button>
      </form>
      <button type="button" onClick={form.edit}>
        Edit
      </button>
      {form.editing && (
        <button type="button" onClick={form.cancelEdit}>
          Cancel
        </button>
      )}
      {form.canDismiss && (
        <button
          type="button"
          onClick={() => void form.dismiss()}
          disabled={form.dismissing}
        >
          {form.dismissing ? "Marking…" : "No comment"}
        </button>
      )}
      <p data-testid="error">{form.error ?? "none"}</p>
    </div>
  );
}

function saveHandler(reply: string | null = null) {
  return mock((_comment: string, _mode: CommentMode) => Promise.resolve(reply));
}

describe("useCommentForm", () => {
  it("shows the stored comment and reply with an empty draft", () => {
    render(
      <Harness
        options={{
          storedComment: "Felt strong on the hills.",
          storedReply: "Good work; keep Thursday easy.",
          onSubmit: saveHandler(),
          dismissErrorMessage: "Could not mark the activity",
        }}
      />,
    );

    expect(screen.getByTestId("comment").textContent).toBe(
      "Felt strong on the hills.",
    );
    expect(screen.getByTestId("reply").textContent).toBe(
      "Good work; keep Thursday easy.",
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe(
      "",
    );
    expect(screen.queryByRole("button", { name: "No comment" })).toBeNull();
  });

  it("saves a trimmed comment and shows the coach's reply", async () => {
    const user = userEvent.setup();
    const onSubmit = saveHandler("Keep the effort easy.");
    render(
      <Harness
        options={{
          storedComment: null,
          storedReply: null,
          onSubmit,
          dismissErrorMessage: "Could not mark the activity",
        }}
      />,
    );

    await user.type(screen.getByLabelText("Comment"), "  Felt strong  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByTestId("comment").textContent).toBe("Felt strong"),
    );
    expect(onSubmit).toHaveBeenCalledWith("Felt strong", "create");
    expect(screen.getByTestId("reply").textContent).toBe(
      "Keep the effort easy.",
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe(
      "",
    );
  });

  it("edits the saved comment and submits it in edit mode", async () => {
    const user = userEvent.setup();
    const onSubmit = saveHandler("Thanks.");
    render(
      <Harness
        options={{
          storedComment: "First version",
          storedReply: null,
          onSubmit,
          dismissErrorMessage: "Could not mark the review",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Comment");
    expect(textarea.value).toBe("First version");

    await user.clear(textarea);
    await user.type(textarea, "Second version");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByTestId("comment").textContent).toBe("Second version"),
    );
    expect(onSubmit).toHaveBeenCalledWith("Second version", "edit");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("cancels an edit without touching the stored comment", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        options={{
          storedComment: "First version",
          storedReply: null,
          onSubmit: saveHandler(),
          dismissErrorMessage: "Could not mark the review",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Comment"));
    await user.type(screen.getByLabelText("Comment"), "Discard me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("comment").textContent).toBe("First version");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe(
      "",
    );
  });

  it("keeps the draft and shows the message when a save fails", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        options={{
          storedComment: null,
          storedReply: null,
          onSubmit: () => Promise.reject(new Error("The API is down")),
          dismissErrorMessage: "Could not mark the activity",
        }}
      />,
    );

    await user.type(screen.getByLabelText("Comment"), "Still here");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The API is down")).toBeDefined();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Comment").value).toBe(
      "Still here",
    );
    expect(screen.getByTestId("comment").textContent).toBe("none");
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  it("disables the draft while a save is in flight", async () => {
    const user = userEvent.setup();
    let finishSave: (reply: string | null) => void = () => undefined;
    const onSubmit = mock(
      () =>
        new Promise<string | null>((resolve) => {
          finishSave = resolve;
        }),
    );
    render(
      <Harness
        options={{
          storedComment: null,
          storedReply: null,
          onSubmit,
          dismissErrorMessage: "Could not mark the activity",
        }}
      />,
    );

    await user.type(screen.getByLabelText("Comment"), "Long effort");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDefined();
    expect(screen.getByLabelText("Comment")).toHaveProperty("disabled", true);

    finishSave("Nice.");

    expect(await screen.findByText("Nice.")).toBeDefined();
  });

  it("marks the review as reviewed with no comment", async () => {
    const user = userEvent.setup();
    let finishDismiss: () => void = () => undefined;
    const onDismiss = mock(
      () =>
        new Promise<void>((resolve) => {
          finishDismiss = resolve;
        }),
    );
    render(
      <Harness
        options={{
          storedComment: null,
          storedReply: null,
          onSubmit: saveHandler(),
          onDismiss,
          dismissErrorMessage: "Could not mark the review",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No comment" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Marking…" })).toHaveProperty(
      "disabled",
      true,
    );

    finishDismiss();

    expect(
      await screen.findByRole("button", { name: "No comment" }),
    ).toBeDefined();
  });
});
