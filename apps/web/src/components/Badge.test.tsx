import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders a muted label as a span by default", () => {
    const html = renderToStaticMarkup(<Badge>Today</Badge>);

    expect(html).toBe(
      '<span class="rounded border px-2 py-0.5 text-sm bg-muted">Today</span>',
    );
  });

  it("renders the accent variant as an inverted marker", () => {
    const html = renderToStaticMarkup(<Badge variant="accent">Admin</Badge>);

    expect(html).toContain("border-transparent");
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent-foreground");
    expect(html).not.toContain("bg-muted");
  });

  it("renders the danger and outline variants", () => {
    const danger = renderToStaticMarkup(<Badge variant="danger">Failed</Badge>);
    const outline = renderToStaticMarkup(
      <Badge variant="outline">Succeeded</Badge>,
    );

    expect(danger).toContain("border-destructive/40");
    expect(danger).toContain("text-destructive");
    expect(outline).toContain("border-border");
    expect(outline).toContain("text-muted-foreground");
    expect(outline).not.toContain("bg-muted");
  });

  it("forwards span attributes and lets the caller override the layout", () => {
    const html = renderToStaticMarkup(
      <Badge className="px-3 capitalize" data-testid="status">
        completed
      </Badge>,
    );

    expect(html).toContain('data-testid="status"');
    expect(html).toContain("capitalize");
    // A deliberate override wins over the primitive's default padding.
    expect(html).toContain("px-3");
    expect(html).not.toContain("px-2");
  });
});
