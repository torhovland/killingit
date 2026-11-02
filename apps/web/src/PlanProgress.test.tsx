import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanProgress } from "./PlanProgress";

function render(
  progress: { step: string; progress: number } | null,
  status: "idle" | "loading" | "syncing" | "thinking",
): string {
  return renderToStaticMarkup(
    <PlanProgress progress={progress} status={status} />,
  );
}

describe("PlanProgress", () => {
  it("renders nothing when the header spinner is idle", () => {
    expect(render(null, "idle")).toBe("");
  });

  it("shows the generation step and a determinate bar", () => {
    const html = render(
      { step: "Building your week", progress: 45 },
      "thinking",
    );

    expect(html).toContain("Building your week");
    expect(html).toContain("45%");
    expect(html).toContain("width:45%");
    expect(html).not.toContain("animate-pulse");
  });

  it("shows an indeterminate bar for another busy state", () => {
    const html = render(null, "syncing");

    expect(html).toContain("Syncing…");
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("%");
  });
});
