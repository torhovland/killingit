import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Menu } from "./Menu";

/** A trigger and its controlled panel, like the account menu. */
function Harness({
  trigger = "Tor",
  className = "",
}: {
  trigger?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      label="Account menu"
      panelLabel="Account"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      className={className}
      testId="menu"
    >
      <button type="button">Coach</button>
      <button type="button">Settings</button>
    </Menu>
  );
}

describe("Menu", () => {
  it("renders a collapsed disclosure trigger with no panel", () => {
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("type")).toBe("button");
    expect(within(trigger).getByText("Tor")).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("opens its labelled navigation panel when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Account menu" }));

    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(within(nav).getByRole("button", { name: "Coach" })).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Account menu" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("closes when the trigger is clicked again", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Account menu" });
    await user.click(trigger);
    await user.click(trigger);

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and gives focus back to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Account menu" });

    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Coach" }),
    );

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a click outside but not on a click inside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">Outside</button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Account menu" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Coach" }));
    expect(screen.getByRole("navigation")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("keeps the root layout and lets the caller extend it", () => {
    render(<Harness className="ml-auto" />);

    const root = screen.getByTestId("menu");
    expect(root.className).toContain("relative");
    expect(root.className).toContain("ml-auto");
  });
});
