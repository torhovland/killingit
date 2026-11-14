import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("renders an accent label as a span by default", () => {
    const html = renderToStaticMarkup(<Chip>Block starts</Chip>);

    expect(html).toStartWith("<span");
    expect(html).toContain("rounded");
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent-foreground");
    expect(html).toContain(">Block starts</span>");
  });

  it("renders a muted label", () => {
    const html = renderToStaticMarkup(<Chip variant="muted">Rest</Chip>);

    expect(html).toContain("bg-muted");
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain("bg-accent");
  });

  it("forwards label attributes and lets the caller tighten the layout", () => {
    const html = renderToStaticMarkup(
      <Chip
        className="line-clamp-2 px-2"
        title="Race: Oslo Marathon"
        data-testid="calendar-event"
      >
        Race
      </Chip>,
    );

    expect(html).toContain('title="Race: Oslo Marathon"');
    expect(html).toContain('data-testid="calendar-event"');
    expect(html).toContain("line-clamp-2");
    // A deliberate override wins over the primitive's default padding.
    expect(html).toContain("px-2");
    expect(html).not.toContain("px-1");
  });
});
