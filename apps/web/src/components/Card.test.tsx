import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "./Card";

describe("Card", () => {
  it("renders a div on the card surface by default", () => {
    const html = renderToStaticMarkup(<Card>Content</Card>);

    expect(html).toStartWith("<div");
    expect(html).toContain("rounded-lg border p-4 bg-card");
  });

  it("renders the requested element and inset surface", () => {
    const html = renderToStaticMarkup(
      <Card as="section" variant="inset" className="rounded p-3">
        Content
      </Card>,
    );

    expect(html).toStartWith("<section");
    expect(html).toContain("bg-inset");
    expect(html).toContain("rounded p-3");
    expect(html).not.toContain("rounded-lg");
    expect(html).not.toContain("p-4");
  });
});
