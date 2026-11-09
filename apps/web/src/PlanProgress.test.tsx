import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  initialPlanProgress,
  PlanProgress,
  WAKING_STEP_LABEL,
  type PlanProgressState,
} from "./PlanProgress";

function render(
  progress: PlanProgressState | null,
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

  it("shows the waking step only while a fresh prompt is on its way", () => {
    expect(initialPlanProgress(Promise.resolve())).toEqual({
      step: WAKING_STEP_LABEL,
      progress: 0,
    });
  });

  it("shows no step when tracking a generation already running on the server", () => {
    expect(initialPlanProgress(null)).toBeNull();
    expect(render(initialPlanProgress(null), "thinking")).toContain(
      "The coach is thinking…",
    );
  });
});
