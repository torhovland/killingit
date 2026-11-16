import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppHeader } from "./AppHeader";
import type { Page } from "./navigation";

interface HeaderOptions {
  signedIn?: boolean;
  loading?: boolean;
  firstName?: string | null;
  isAdmin?: boolean;
  status?: "idle" | "loading" | "syncing" | "thinking";
  page?: Page;
  installable?: boolean;
}

function renderHeader(options: HeaderOptions = {}) {
  const onInstall = mock<() => void>();
  const onNavigate = mock<(page: Page) => void>();
  const onSignOut = mock<() => void>();
  render(
    <AppHeader
      signedIn={options.signedIn ?? true}
      loading={options.loading ?? false}
      firstName={options.firstName === undefined ? "Tor" : options.firstName}
      picture={null}
      isAdmin={options.isAdmin ?? false}
      status={options.status ?? "idle"}
      page={options.page ?? "coach"}
      installable={options.installable ?? false}
      onInstall={onInstall}
      onNavigate={onNavigate}
      onSignOut={onSignOut}
    />,
  );
  return { onInstall, onNavigate, onSignOut };
}

describe("AppHeader", () => {
  it("shows a loading note while a signed-out session settles", () => {
    renderHeader({ signedIn: false, loading: true });

    expect(screen.getByText("Loading…")).toBeDefined();
    expect(screen.queryByTestId("user-menu")).toBeNull();
  });

  it("shows neither a menu nor a note to a signed-out visitor", () => {
    renderHeader({ signedIn: false, loading: false });

    expect(screen.queryByTestId("user-menu")).toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("shows the account menu to the signed-in athlete", () => {
    renderHeader({ firstName: "Tor", isAdmin: true, page: "fitness" });

    const menu = screen.getByTestId("user-menu");
    expect(menu.textContent).toContain("Tor");
    expect(menu.textContent).toContain("Admin");
  });

  it("offers the install action only while the browser does", async () => {
    const { onInstall } = renderHeader({ installable: true });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Install app" }));

    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("hides the install action when installation is not offered", () => {
    renderHeader({ installable: false });

    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("navigates to the coach page from the brand link", async () => {
    const { onNavigate } = renderHeader({ page: "calendar" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("link", { name: "Killing It" }));

    expect(onNavigate).toHaveBeenCalledWith("coach");
  });
});
