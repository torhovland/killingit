import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanRegenerationButtonsView } from "./PlanRegenerationButtons";

function render({
  hasSeason,
  running = null,
}: {
  hasSeason: boolean;
  running?: "newSeason" | "updateSeason" | null;
}): string {
  return renderToStaticMarkup(
    <PlanRegenerationButtonsView
      hasSeason={hasSeason}
      running={running}
      done={false}
      error={null}
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
});
