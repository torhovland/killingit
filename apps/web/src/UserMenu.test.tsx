import { describe, expect, it, mock } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserMenu } from "./UserMenu";
import type { Page } from "./navigation";

interface MenuOptions {
  firstName?: string | null;
  isAdmin?: boolean;
  status?: "idle" | "loading" | "syncing" | "thinking";
  currentPage?: Page;
}

function renderMenu(options: MenuOptions = {}) {
  const onNavigate = mock<(page: Page) => void>();
  const onSignOut = mock<() => void>();
  render(
    <UserMenu
      firstName={options.firstName === undefined ? "Tor" : options.firstName}
      picture={null}
      isAdmin={options.isAdmin ?? false}
      status={options.status ?? "idle"}
      currentPage={options.currentPage ?? "coach"}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
    />,
  );
  return { onNavigate, onSignOut };
}

/** Opens the account panel from its trigger. */
async function openPanel() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  return user;
}

describe("UserMenu", () => {
  it("shows the athlete's name and marks the current page", async () => {
    renderMenu({ firstName: "Tor", currentPage: "diet" });

    expect(screen.getByText("Tor")).toBeDefined();
    expect(screen.getByText("T")).toBeDefined();
    await openPanel();

    const panel = screen.getByRole("navigation", { name: "Account" });
    expect(
      within(panel)
        .getByRole("button", { name: "Diet" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(panel)
        .getByRole("button", { name: "Coach" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("falls back to Athlete without a first name", () => {
    renderMenu({ firstName: "  " });

    expect(screen.getByText("Athlete")).toBeDefined();
    expect(screen.getByText("A")).toBeDefined();
  });

  it("closes the panel and navigates to the chosen page", async () => {
    const { onNavigate } = renderMenu();
    const user = await openPanel();

    await user.click(screen.getByRole("button", { name: "Fitness" }));

    expect(onNavigate).toHaveBeenCalledWith("fitness");
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
  });

  it("hides the admin item and badge from a member", async () => {
    renderMenu({ isAdmin: false });
    await openPanel();

    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByRole("button", { name: "Admin settings" })).toBeNull();
  });

  it("shows the admin item and badge to the admin", async () => {
    renderMenu({ isAdmin: true });
    await openPanel();

    expect(screen.getByText("Admin")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Admin settings" }),
    ).toBeDefined();
  });

  it("reports the shared busy state on the trigger", () => {
    renderMenu({ status: "thinking" });

    expect(
      screen.getByRole("status", { name: "The coach is thinking" }),
    ).toBeDefined();
  });

  it("shows no spinner when the app is idle", () => {
    renderMenu({ status: "idle" });

    expect(screen.queryByTestId("spinner")).toBeNull();
  });

  it("closes the panel and signs out", async () => {
    const { onSignOut } = renderMenu();
    const user = await openPanel();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
  });
});
