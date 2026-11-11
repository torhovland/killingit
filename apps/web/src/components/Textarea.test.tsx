import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("renders a full-width field by default", () => {
    const html = renderToStaticMarkup(<Textarea aria-label="Note" />);

    expect(html).toStartWith("<textarea");
    expect(html).toContain("rounded border bg-card");
    expect(html).toContain("w-full p-2 text-base");
  });

  it("renders the line size and merges the caller's classes", () => {
    const html = renderToStaticMarkup(
      <Textarea size="line" className="font-normal" aria-label="Note" />,
    );

    expect(html).toContain("px-3 py-1");
    expect(html).not.toContain("p-2");
    expect(html).toContain("font-normal");
  });
});
