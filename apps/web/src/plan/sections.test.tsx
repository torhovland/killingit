import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RefreshingOverlay } from "./sections";

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
