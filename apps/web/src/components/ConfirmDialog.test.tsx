import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

function Harness({
  onConfirm = () => undefined,
  busy = false,
  error = null,
}: {
  onConfirm?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete activity
      </button>
      {open && (
        <ConfirmDialog
          title="Delete this activity?"
          description="It disappears from your coaching view."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onConfirm={onConfirm}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("names the dialog, describes the consequence and focuses the safe action", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Delete activity" }));

    const dialog = screen.getByRole("dialog");
    const heading = within(dialog).getByRole("heading", {
      name: "Delete this activity?",
    });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(
      within(dialog).getByText("It disappears from your coaching view."),
    ).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeDefined();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
  });

  it("confirms only from the destructive action", async () => {
    const user = userEvent.setup();
    let confirmed = 0;
    render(<Harness onConfirm={() => (confirmed += 1)} />);
    await user.click(screen.getByRole("button", { name: "Delete activity" }));

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmed).toBe(1);
  });

  it("cancels on Escape and on a backdrop click without confirming", async () => {
    const user = userEvent.setup();
    let confirmed = 0;
    render(<Harness onConfirm={() => (confirmed += 1)} />);
    await user.click(screen.getByRole("button", { name: "Delete activity" }));

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete activity" }));
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(confirmed).toBe(0);
  });

  it("shows the action's busy state and blocks every close path", async () => {
    const user = userEvent.setup();
    render(<Harness busy />);
    await user.click(screen.getByRole("button", { name: "Delete activity" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: "Cancel",
      }).disabled,
    ).toBe(true);
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: "Deleting…",
      }).disabled,
    ).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("shows a failed action's error inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness error="Could not delete the activity" />);
    await user.click(screen.getByRole("button", { name: "Delete activity" }));

    expect(
      within(screen.getByRole("dialog")).getByText(
        "Error: Could not delete the activity",
      ),
    ).toBeDefined();
  });
});
