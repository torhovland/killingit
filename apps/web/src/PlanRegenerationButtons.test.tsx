import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanRegenerationButtonsView } from "./PlanRegenerationButtons";

function render(hasSeason: boolean): string {
  return renderToStaticMarkup(
    <PlanRegenerationButtonsView
      hasSeason={hasSeason}
      running={null}
      done={false}
      error={null}
      onNewSeason={() => undefined}
      onUpdateSeason={() => undefined}
    />,
  );
}

describe("PlanRegenerationButtonsView", () => {
  it("offers only a new season when no season exists", () => {
    const html = render(false);

    expect(html).toContain("Plan a new season");
    expect(html).not.toContain("Update season plan");
  });

  it("offers both actions when a season exists", () => {
    const html = render(true);

    expect(html).toContain("Plan a new season");
    expect(html).toContain("Update season plan");
    expect(html).toContain("keeps completed blocks");
  });

  it("names the running action", () => {
    const html = renderToStaticMarkup(
      <PlanRegenerationButtonsView
        hasSeason={true}
        running="updateSeason"
        done={false}
        error={null}
        onNewSeason={() => undefined}
        onUpdateSeason={() => undefined}
      />,
    );

    expect(html).toContain("Updating your season…");
    expect(html).toContain("disabled");
  });
});
