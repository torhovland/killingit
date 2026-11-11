import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "./Input";

describe("Input", () => {
  it("renders a text field by default", () => {
    const html = renderToStaticMarkup(<Input aria-label="Name" />);

    expect(html).toStartWith("<input");
    expect(html).toContain('type="text"');
    expect(html).toContain("rounded border bg-card");
    expect(html).toContain("w-full p-2 text-base");
  });

  it("keeps an explicit type and merges the caller's classes", () => {
    const html = renderToStaticMarkup(
      <Input type="date" size="sm" className="w-fit" aria-label="Date" />,
    );

    expect(html).toContain('type="date"');
    expect(html).toContain("px-2 py-1");
    expect(html).toContain("w-fit");
  });
});
