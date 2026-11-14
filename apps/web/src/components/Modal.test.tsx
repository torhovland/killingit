import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Modal } from "./Modal";

function Dialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      labelledBy="example-title"
      describedBy="example-description"
      onClose={onClose}
      className="max-w-md"
      testId="example-dialog"
    >
      <h3 id="example-title">Delete your account?</h3>
      <p id="example-description">This cannot be undone.</p>
      <button type="button">First</button>
      <button type="button" onClick={onClose}>
        Second
      </button>
    </Modal>
  );
}

/** A trigger and a conditionally mounted dialog, like every real caller. */
function Harness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      )}
    </>
  );
}

describe("Modal", () => {
  it("renders an accessible dialog around its content", () => {
    render(<Dialog onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("example-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("example-description");
    expect(dialog.getAttribute("data-testid")).toBe("example-dialog");
    expect(within(dialog).getByText("Delete your account?")).toBeDefined();
    expect(within(dialog).getByText("This cannot be undone.")).toBeDefined();
  });

  it("moves focus to the first focusable element", () => {
    render(<Dialog onClose={() => undefined} />);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "First" }),
    );
  });

  it("focuses the panel itself when there is nothing focusable inside", () => {
    render(
      <Modal labelledBy="empty-title" onClose={() => undefined}>
        <h3 id="empty-title">Nothing to focus</h3>
      </Modal>,
    );

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("wraps Tab from the last element back to the first", async () => {
    const user = userEvent.setup();
    render(<Dialog onClose={() => undefined} />);
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });

    await user.tab();
    expect(document.activeElement).toBe(second);
    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first element back to the last", async () => {
    const user = userEvent.setup();
    render(<Dialog onClose={() => undefined} />);
    const second = screen.getByRole("button", { name: "Second" });

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(second);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    let closed = 0;
    render(<Dialog onClose={() => (closed += 1)} />);

    await user.keyboard("{Escape}");

    expect(closed).toBe(1);
  });

  it("closes on a backdrop click but not on a panel click", async () => {
    const user = userEvent.setup();
    let closed = 0;
    render(<Dialog onClose={() => (closed += 1)} />);
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("heading"));
    expect(closed).toBe(0);

    await user.click(screen.getByRole("presentation"));
    expect(closed).toBe(1);
  });

  it("restores focus to the trigger when it closes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeDefined();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the latest onClose without re-running focus capture", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog onClose={() => undefined} />);
    const first = screen.getByRole("button", { name: "First" });

    rerender(<Dialog onClose={() => undefined} />);

    expect(document.activeElement).toBe(first);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Second" }),
    );
  });

  it("lets the caller set the panel width without repeating the surface", () => {
    render(<Dialog onClose={() => undefined} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("w-full rounded-lg border bg-card p-4");
    expect(dialog.className).toContain("max-w-md");
  });
});
