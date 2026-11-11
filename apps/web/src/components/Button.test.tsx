import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a plain button by default", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);

    expect(html).toStartWith('<button type="button"');
    expect(html).toContain("rounded border bg-card");
    expect(html).toContain("px-3 py-1 text-base");
  });

  it("renders the requested variant and size", () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" size="lg">
        Save
      </Button>,
    );

    expect(html).toContain("bg-primary");
    expect(html).toContain("px-4 py-2 text-base");
  });

  it("lets the caller override a base class", () => {
    const html = renderToStaticMarkup(
      <Button variant="secondary" size="md" className="text-sm self-start">
        Save
      </Button>,
    );

    expect(html).toContain("text-sm");
    expect(html).not.toContain("text-base");
    expect(html).toContain("self-start");
  });
});
