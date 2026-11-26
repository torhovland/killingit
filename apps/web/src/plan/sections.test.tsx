import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DietProgressLine, RefreshingOverlay } from "./sections";

describe("RefreshingOverlay", () => {
  it("shows the labelled shared spinner over the level", () => {
    const html = renderToStaticMarkup(
      <RefreshingOverlay label="today" testId="today-refreshing" />,
    );

    expect(html).toContain('data-testid="today-refreshing"');
    expect(html).toContain('data-testid="spinner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Updating today plan"');
    expect(html).toContain("size-6");
    expect(html).toContain("text-primary");
    expect(html).toContain("Updating today plan…");
  });
});

describe("DietProgressLine", () => {
  it("renders the target as plain text instead of a panel", () => {
    const html = renderToStaticMarkup(
      <DietProgressLine
        progress={{
          targetWeightKg: 81.5,
          targetBodyFatPercent: 18,
          note: "Hold weight through the week.",
        }}
        period="the week"
        testId="week-diet-progress"
      />,
    );

    expect(html).toContain('data-testid="week-diet-progress"');
    expect(html).toContain("Diet target by the end of the week:");
    expect(html).toContain("81.5 kg and 18.0 % body fat");
    expect(html).not.toContain("font-medium");
    expect(html).not.toContain("rounded-lg border p-4");
    expect(html).not.toContain("bg-card");
  });

  it("renders nothing when the period has no numeric target", () => {
    const html = renderToStaticMarkup(
      <DietProgressLine
        progress={{
          targetWeightKg: null,
          targetBodyFatPercent: null,
          note: "No post-February body-composition target was stated.",
        }}
        period="the block"
        testId="block-diet-progress"
      />,
    );

    expect(html).toBe("");
  });
});
