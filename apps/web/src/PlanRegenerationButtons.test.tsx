import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PlanRegenerationButtonsView,
  seasonSetupNotice,
} from "./PlanRegenerationButtons";

function renderButtons({
  hasSeason,
  running = null,
  busy = running !== null,
  setupNotice = null,
  onNewSeason = () => undefined,
  onUpdateSeason = () => undefined,
}: {
  hasSeason: boolean;
  running?: "newSeason" | "updateSeason" | null;
  busy?: boolean;
  setupNotice?: string | null;
  onNewSeason?: () => void;
  onUpdateSeason?: () => void;
}) {
  render(
    <PlanRegenerationButtonsView
      hasSeason={hasSeason}
      running={running}
      busy={busy}
      done={false}
      error={null}
      setupNotice={setupNotice}
      onNewSeason={onNewSeason}
      onUpdateSeason={onUpdateSeason}
    />,
  );
}

describe("PlanRegenerationButtonsView", () => {
  it("offers only a new season when no season exists", () => {
    renderButtons({ hasSeason: false });

    expect(
      screen.getByRole("button", { name: "Plan a new season" }).className,
    ).toContain("bg-primary");
    expect(
      screen.queryByRole("button", { name: "Update season plan" }),
    ).toBeNull();
  });

  it("makes updating the primary action when a season exists", () => {
    renderButtons({ hasSeason: true });

    expect(
      screen.getByRole("button", { name: "Update season plan" }).className,
    ).toContain("bg-primary");
    expect(
      screen.getByRole("button", { name: "Plan a new season" }).className,
    ).not.toContain("bg-primary");
    expect(screen.getByText(/keeps completed blocks/)).toBeDefined();
  });

  it("runs the action that was clicked", async () => {
    const user = userEvent.setup();
    const onNewSeason = mock(() => undefined);
    const onUpdateSeason = mock(() => undefined);
    renderButtons({ hasSeason: true, onNewSeason, onUpdateSeason });

    await user.click(screen.getByRole("button", { name: "Plan a new season" }));
    await user.click(
      screen.getByRole("button", { name: "Update season plan" }),
    );

    expect(onNewSeason).toHaveBeenCalledTimes(1);
    expect(onUpdateSeason).toHaveBeenCalledTimes(1);
  });

  it("spins and names the coach on the action that is running", () => {
    renderButtons({ hasSeason: true, running: "updateSeason" });

    const running = screen.getByRole("button", { name: "Coach is thinking…" });
    expect(running.className).toContain("bg-primary");
    expect(running).toHaveProperty("disabled", true);
    expect(screen.getAllByTestId("spinner")).toHaveLength(1);
    // The other action stays identifiable but cannot be started.
    expect(
      screen.getByRole("button", { name: "Plan a new season" }),
    ).toHaveProperty("disabled", true);
  });

  it("spins on a new season when it is the only action", () => {
    renderButtons({ hasSeason: false, running: "newSeason" });

    expect(
      screen.getByRole("button", { name: "Coach is thinking…" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Plan a new season" }),
    ).toBeNull();
  });

  it("disables every action while another generation is running", async () => {
    const user = userEvent.setup();
    const onNewSeason = mock(() => undefined);
    const onUpdateSeason = mock(() => undefined);
    renderButtons({ hasSeason: true, busy: true, onNewSeason, onUpdateSeason });

    const update = screen.getByRole("button", { name: "Update season plan" });
    const start = screen.getByRole("button", { name: "Plan a new season" });
    expect(update).toHaveProperty("disabled", true);
    expect(start).toHaveProperty("disabled", true);
    // The run was started elsewhere, so no button claims to be the one running.
    expect(
      screen.queryByRole("button", { name: "Coach is thinking…" }),
    ).toBeNull();

    await user.click(update);
    await user.click(start);
    expect(onUpdateSeason).not.toHaveBeenCalled();
    expect(onNewSeason).not.toHaveBeenCalled();
  });

  it("shows which integrations are missing before a season can start", () => {
    renderButtons({
      hasSeason: false,
      setupNotice:
        "Set up Garmin and an OpenRouter API key in Settings before planning a new season.",
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Set up Garmin and an OpenRouter API key",
    );
  });
});

describe("seasonSetupNotice", () => {
  it("asks for both integrations when neither is set up", () => {
    expect(
      seasonSetupNotice({ garminConnected: false, llmConfigured: false }),
    ).toBe(
      "Set up Garmin and an OpenRouter API key in Settings before planning a new season.",
    );
  });

  it("asks only for Garmin when OpenRouter is configured", () => {
    expect(
      seasonSetupNotice({ garminConnected: false, llmConfigured: true }),
    ).toBe("Set up Garmin in Settings before planning a new season.");
  });

  it("asks only for OpenRouter when Garmin is connected", () => {
    expect(
      seasonSetupNotice({ garminConnected: true, llmConfigured: false }),
    ).toBe(
      "Set up an OpenRouter API key in Settings before planning a new season.",
    );
  });

  it("returns null when both integrations are ready", () => {
    expect(
      seasonSetupNotice({ garminConnected: true, llmConfigured: true }),
    ).toBeNull();
  });
});
