import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PlanRegenerationButtonsView,
  seasonSetupNotice,
} from "./PlanRegenerationButtons";

function render({
  hasSeason,
  running = null,
  busy = running !== null,
  setupNotice = null,
}: {
  hasSeason: boolean;
  running?: "newSeason" | "updateSeason" | null;
  busy?: boolean;
  setupNotice?: string | null;
}): string {
  return renderToStaticMarkup(
    <PlanRegenerationButtonsView
      hasSeason={hasSeason}
      running={running}
      busy={busy}
      done={false}
      error={null}
      setupNotice={setupNotice}
      onNewSeason={() => undefined}
      onUpdateSeason={() => undefined}
    />,
  );
}

/** The markup of the single button whose label contains `label`. */
function buttonFor(html: string, label: string): string {
  const button = html
    .split("<button")
    .find((part) => part.includes(label) && part.includes("</button>"));
  if (button === undefined) {
    throw new Error(`No button with label "${label}"`);
  }
  return button;
}

describe("PlanRegenerationButtonsView", () => {
  it("offers only a new season when no season exists", () => {
    const html = render({ hasSeason: false });

    expect(html).toContain("Plan a new season");
    expect(html).not.toContain("Update season plan");
    expect(buttonFor(html, "Plan a new season")).toContain("bg-primary");
  });

  it("makes updating the primary action when a season exists", () => {
    const html = render({ hasSeason: true });

    expect(html).toContain("Plan a new season");
    expect(html).toContain("Update season plan");
    expect(html).toContain("keeps completed blocks");
    expect(buttonFor(html, "Update season plan")).toContain("bg-primary");
    expect(buttonFor(html, "Plan a new season")).not.toContain("bg-primary");
  });

  it("spins and names the coach on the action that is running", () => {
    const html = render({ hasSeason: true, running: "updateSeason" });

    const updateButton = buttonFor(html, "Coach is thinking…");
    expect(updateButton).toContain('data-testid="spinner"');
    expect(updateButton).toContain("animate-spin");
    expect(updateButton).toContain("disabled");
    // The other action stays identifiable but cannot be started.
    expect(buttonFor(html, "Plan a new season")).toContain("disabled");
    expect(html.match(/data-testid="spinner"/g)).toHaveLength(1);
  });

  it("spins on a new season when it is the only action", () => {
    const html = render({ hasSeason: false, running: "newSeason" });

    expect(buttonFor(html, "Coach is thinking…")).toContain(
      'data-testid="spinner"',
    );
    expect(html).not.toContain("Plan a new season");
  });

  it("disables every action while another generation is running", () => {
    const html = render({ hasSeason: true, busy: true });

    expect(buttonFor(html, "Update season plan")).toContain("disabled");
    expect(buttonFor(html, "Plan a new season")).toContain("disabled");
    // The run was started elsewhere, so no button claims to be the one running.
    expect(html).not.toContain("Coach is thinking…");
  });

  it("shows which integrations are missing before a season can start", () => {
    const html = render({
      hasSeason: false,
      setupNotice:
        "Set up Garmin and an OpenRouter API key in Settings before planning a new season.",
    });

    expect(html).toContain("Set up Garmin and an OpenRouter API key");
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
